CREATE TABLE calling_sessions (
 clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 agent_id uuid NOT NULL, call_id uuid NOT NULL, caller_hash text NOT NULL,
 last_turn integer NOT NULL DEFAULT 0, ended boolean NOT NULL DEFAULT false, in_flight boolean NOT NULL DEFAULT false,
 conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(clinic_id,agent_id,call_id)
);
ALTER TABLE calling_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE calling_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_isolation ON calling_sessions USING(clinic_id=app_clinic_id()) WITH CHECK(clinic_id=app_clinic_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON calling_sessions TO sahayak_app;
