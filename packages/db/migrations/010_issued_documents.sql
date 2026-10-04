-- Medical certificates and prescriptions: drafted by the assistant from the doctor's words, signed by the doctor.
CREATE TABLE issued_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES doctors(id),
  kind text NOT NULL CHECK (kind IN ('certificate','prescription')),
  subtype text NOT NULL CHECK (subtype IN ('sick_leave','fitness','attendance','prescription')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','signed','void')),
  content jsonb NOT NULL DEFAULT '{}',
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en','hi','both')),
  doc_number text,
  verify_code text UNIQUE,
  pdf bytea,
  warnings jsonb NOT NULL DEFAULT '[]',
  created_by uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  signed_at timestamptz,
  signed_by uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  sent_at timestamptz,
  void_reason text,
  voided_at timestamptz,
  UNIQUE (clinic_id, doc_number)
);
CREATE INDEX ON issued_documents (patient_id, created_at DESC);

CREATE TABLE doc_counters (
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  year int NOT NULL,
  prefix text NOT NULL,
  next_no int NOT NULL DEFAULT 1,
  PRIMARY KEY (clinic_id, year, prefix)
);

CREATE TABLE document_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES issued_documents(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  downloads int NOT NULL DEFAULT 0,
  max_downloads int NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['issued_documents','doc_counters','document_links'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY clinic_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

-- Once signed, the content, number and PDF can never change and the document can never be deleted by the application.
-- The only allowed changes afterwards: marking it void, and recording that it was sent.
CREATE OR REPLACE FUNCTION guard_issued_documents() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('signed','void') AND current_user = 'sahayak_app' THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'signed documents cannot be deleted'; END IF;
    IF NEW.content IS DISTINCT FROM OLD.content OR NEW.doc_number IS DISTINCT FROM OLD.doc_number
       OR NEW.pdf IS DISTINCT FROM OLD.pdf OR NEW.verify_code IS DISTINCT FROM OLD.verify_code
       OR NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.signed_at IS DISTINCT FROM OLD.signed_at
       OR (OLD.status = 'void' AND NEW.status <> 'void') OR (OLD.status = 'signed' AND NEW.status = 'draft') THEN
      RAISE EXCEPTION 'signed documents cannot be changed';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER issued_documents_guard BEFORE UPDATE OR DELETE ON issued_documents FOR EACH ROW EXECUTE FUNCTION guard_issued_documents();

-- Gapless-per-year numbering, e.g. RX-2026-000042. Serialised per clinic and prefix by the row lock.
CREATE OR REPLACE FUNCTION next_doc_number(p_prefix text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE y int := extract(year FROM now() AT TIME ZONE 'Asia/Kolkata')::int; n int;
BEGIN
  INSERT INTO doc_counters (clinic_id, year, prefix, next_no) VALUES (app_clinic_id(), y, p_prefix, 2)
    ON CONFLICT (clinic_id, year, prefix) DO UPDATE SET next_no = doc_counters.next_no + 1 RETURNING next_no - 1 INTO n;
  RETURN p_prefix || '-' || y || '-' || lpad(n::text, 6, '0');
END $$;

-- Anyone with a verification code can confirm a document is genuine. Reveals no medical content.
CREATE OR REPLACE FUNCTION verify_document(p_code text)
RETURNS TABLE (kind text, subtype text, doc_number text, issued_on date, status text, doctor_name text, registration_no text, clinic_name text, patient_initials text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT d.kind, d.subtype, d.doc_number, (d.signed_at AT TIME ZONE 'Asia/Kolkata')::date, d.status, dr.name, dr.registration_no, c.name,
         (SELECT string_agg(left(w, 1) || '.', ' ') FROM unnest(string_to_array(p.name, ' ')) w)
    FROM issued_documents d JOIN doctors dr ON dr.id = d.doctor_id JOIN clinics c ON c.id = d.clinic_id JOIN patients p ON p.id = d.patient_id
   WHERE d.verify_code = p_code AND d.status IN ('signed','void')
$$;

-- Download through a private link: counts downloads and honours expiry in one atomic step.
CREATE OR REPLACE FUNCTION fetch_document_link(p_hash text)
RETURNS TABLE (pdf bytea, doc_number text, status text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l document_links%ROWTYPE;
BEGIN
  SELECT * INTO l FROM document_links WHERE token_hash = p_hash AND expires_at > now() AND downloads < max_downloads FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE document_links SET downloads = downloads + 1 WHERE id = l.id;
  RETURN QUERY SELECT d.pdf, d.doc_number, d.status FROM issued_documents d WHERE d.id = l.document_id AND d.status IN ('signed','void');
END $$;

-- The retention purge must also remove issued documents.
CREATE OR REPLACE FUNCTION purge_patient_clinical(p_clinic uuid, p_patient uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int := 0; c int;
BEGIN
  IF p_clinic IS DISTINCT FROM app_clinic_id() THEN RAISE EXCEPTION 'wrong clinic context'; END IF;
  DELETE FROM visit_notes WHERE patient_id = p_patient AND clinic_id = p_clinic AND amends_note_id IS NOT NULL;
  GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  DELETE FROM visit_notes WHERE patient_id = p_patient AND clinic_id = p_clinic;
  GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  DELETE FROM patient_documents WHERE patient_id = p_patient AND clinic_id = p_clinic;
  GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  DELETE FROM issued_documents WHERE patient_id = p_patient AND clinic_id = p_clinic;
  GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  RETURN n;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sahayak_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sahayak_app;
REVOKE UPDATE, DELETE ON agent_actions, settings_changes FROM sahayak_app;
REVOKE INSERT, UPDATE, DELETE ON clinics FROM sahayak_app;
GRANT EXECUTE ON FUNCTION next_doc_number(text), verify_document(text), fetch_document_link(text), purge_patient_clinical(uuid, uuid) TO sahayak_app;
