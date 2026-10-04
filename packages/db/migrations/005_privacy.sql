-- DPDP: retention rules, data-request log, audit redaction.
ALTER TABLE clinic_settings ADD COLUMN retention_rules jsonb NOT NULL
  DEFAULT '{"messages_days": 180, "intake_days": 365, "audit_days": 730, "inactive_patient_days": 1095}';

-- Log of privacy requests. Holds no personal data: only what kind of request, how it arrived and when.
CREATE TABLE data_requests (
  id bigserial PRIMARY KEY,
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('export','erase','withdraw_messaging','retention_erase')),
  via text NOT NULL CHECK (via IN ('whatsapp','staff','retention','api','voice')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE data_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_isolation ON data_requests USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());

-- The audit log is append-only for the app role. Erasure and retention must still be able to strip personal
-- content from old entries (keeping that an action happened, who did it and when). Only these two vetted
-- functions may do that, and only for the clinic in the current RLS context.
CREATE OR REPLACE FUNCTION redact_patient_audit(p_clinic uuid, p_patient uuid, p_conversations uuid[], p_phone text, p_name text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF p_clinic IS DISTINCT FROM app_clinic_id() THEN RAISE EXCEPTION 'wrong clinic context'; END IF;
  -- Entries about this patient: by patient/conversation link, or because the payload mentions their id, phone or full name
  -- (e.g. a doctor's "call next" result or a receptionist's export, which carry no patient link).
  UPDATE agent_actions SET input = '{"redacted": true}', output = NULL
   WHERE clinic_id = p_clinic
     AND (patient_id = p_patient OR conversation_id = ANY(p_conversations)
          OR position(p_patient::text IN COALESCE(input::text,'') || COALESCE(output::text,'')) > 0
          OR (p_phone IS NOT NULL AND length(p_phone) >= 8 AND position(p_phone IN COALESCE(input::text,'') || COALESCE(output::text,'')) > 0)
          OR (p_name IS NOT NULL AND length(p_name) >= 8 AND position(p_name IN COALESCE(input::text,'') || COALESCE(output::text,'')) > 0))
     AND (input IS DISTINCT FROM '{"redacted": true}');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION redact_old_audit(p_clinic uuid, p_days int)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF p_clinic IS DISTINCT FROM app_clinic_id() THEN RAISE EXCEPTION 'wrong clinic context'; END IF;
  IF p_days < 365 THEN RAISE EXCEPTION 'audit retention cannot be shorter than 365 days'; END IF;
  UPDATE agent_actions SET input = '{"redacted": true}', output = NULL
   WHERE clinic_id = p_clinic AND created_at < now() - make_interval(days => p_days) AND (input IS DISTINCT FROM '{"redacted": true}');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sahayak_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sahayak_app;
REVOKE UPDATE, DELETE ON agent_actions, settings_changes FROM sahayak_app;
REVOKE INSERT, UPDATE, DELETE ON clinics FROM sahayak_app;
GRANT EXECUTE ON FUNCTION redact_patient_audit(uuid, uuid, uuid[], text, text), redact_old_audit(uuid, int) TO sahayak_app;
