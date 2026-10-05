CREATE TABLE agent_platform_receipts (
 clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 channel_id uuid NOT NULL, event_id uuid NOT NULL, digest text NOT NULL,
 state text NOT NULL CHECK(state IN ('PROCESSING','DONE','UNKNOWN')),
 conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
 response jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(clinic_id,channel_id,event_id)
);
ALTER TABLE agent_platform_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_platform_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_isolation ON agent_platform_receipts USING(clinic_id=app_clinic_id()) WITH CHECK(clinic_id=app_clinic_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON agent_platform_receipts TO sahayak_app;
CREATE INDEX agent_platform_receipts_conversation ON agent_platform_receipts(clinic_id,conversation_id);
