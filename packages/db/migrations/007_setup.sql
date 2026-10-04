-- Guided clinic setup: progress flag, clinic creation and renaming (the app role cannot write `clinics` directly).
ALTER TABLE clinic_settings ADD COLUMN setup jsonb NOT NULL DEFAULT '{"completed": false}';

-- Removing a login must not be blocked by (or erase) the history it created: keep the rows, drop the link.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('conversations','human_user_id'),('flags','resolved_by'),('schedule_proposals','created_by'),
                                 ('api_keys','created_by'),('webhooks','created_by'),('settings_changes','changed_by')) AS v(t, c) LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.t, r.t || '_' || r.c || '_fkey');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES staff_users(id) ON DELETE SET NULL', r.t, r.t || '_' || r.c || '_fkey', r.c);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION create_clinic(p_slug text, p_name text, p_doctor_name text, p_email text, p_password_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid uuid; did uuid;
BEGIN
  IF p_slug !~ '^[a-z0-9][a-z0-9-]{2,39}$' THEN RAISE EXCEPTION 'invalid_slug'; END IF;
  IF EXISTS (SELECT 1 FROM clinics WHERE slug = p_slug) THEN RAISE EXCEPTION 'slug_taken'; END IF;
  IF EXISTS (SELECT 1 FROM staff_users WHERE email = lower(p_email)) THEN RAISE EXCEPTION 'email_in_use'; END IF;
  INSERT INTO clinics (slug, name) VALUES (p_slug, p_name) RETURNING id INTO cid;
  INSERT INTO clinic_settings (clinic_id, timings, avg_consult_minutes, intake_questions) VALUES (
    cid,
    '{"mon":"09:00-13:00, 17:00-20:00","tue":"09:00-13:00, 17:00-20:00","wed":"09:00-13:00, 17:00-20:00","thu":"09:00-13:00, 17:00-20:00","fri":"09:00-13:00, 17:00-20:00","sat":"09:00-13:00","sun":""}',
    10,
    '[{"id":"reason","en":"What is the main reason for your visit today?","hi":"आज आपकी विज़िट का मुख्य कारण क्या है?"},{"id":"duration","en":"How long have you had this problem?","hi":"यह समस्या कब से है?"}]'
  );
  INSERT INTO doctors (clinic_id, name) VALUES (cid, p_doctor_name) RETURNING id INTO did;
  INSERT INTO staff_users (clinic_id, email, password_hash, name, role, doctor_id) VALUES (cid, lower(p_email), p_password_hash, p_doctor_name, 'doctor', did);
  RETURN cid;
END $$;

CREATE OR REPLACE FUNCTION rename_clinic(p_name text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app_clinic_id() IS NULL THEN RAISE EXCEPTION 'no clinic context'; END IF;
  UPDATE clinics SET name = p_name WHERE id = app_clinic_id();
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sahayak_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sahayak_app;
REVOKE UPDATE, DELETE ON agent_actions, settings_changes FROM sahayak_app;
REVOKE INSERT, UPDATE, DELETE ON clinics FROM sahayak_app;
GRANT EXECUTE ON FUNCTION create_clinic(text, text, text, text, text), rename_clinic(text) TO sahayak_app;
