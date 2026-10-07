ALTER TABLE patient_checkins ADD COLUMN work_status text NOT NULL DEFAULT 'planned' CHECK(work_status IN ('planned','new','assigned','contacted','action_taken','closed'));
ALTER TABLE patient_checkins ADD COLUMN category text NOT NULL DEFAULT 'review' CHECK(category IN ('review','clinical','callback','service','instructions'));
ALTER TABLE patient_checkins ADD COLUMN urgent boolean NOT NULL DEFAULT false;
ALTER TABLE patient_checkins ADD COLUMN response_due_at timestamptz;
ALTER TABLE patient_checkins ADD COLUMN first_contacted_at timestamptz;
ALTER TABLE patient_checkins ADD COLUMN reminder_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE patient_checkins ADD COLUMN analysis jsonb;
ALTER TABLE patient_checkins ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE patient_feedback_responses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 checkin_id uuid NOT NULL UNIQUE REFERENCES patient_checkins(id) ON DELETE CASCADE,
 recovery text NOT NULL CHECK(recovery IN ('better','same','worse','callback')),
 help text NOT NULL CHECK(help IN ('none','instructions','medicine','next_steps','visit','other')),
 theme text NOT NULL CHECK(theme IN ('none','waiting','explanation','staff','fees','booking','other')),
 message text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE patient_feedback_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 checkin_id uuid NOT NULL REFERENCES patient_checkins(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES staff_users(id), kind text NOT NULL, note text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE patient_feedback_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 checkin_id uuid NOT NULL REFERENCES patient_checkins(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE, purpose text NOT NULL CHECK(purpose IN ('response','resolution')),
 expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE patient_feedback_resolutions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 checkin_id uuid NOT NULL REFERENCES patient_checkins(id) ON DELETE CASCADE,
 link_id uuid NOT NULL UNIQUE REFERENCES patient_feedback_links(id) ON DELETE CASCADE,
 answer text NOT NULL CHECK(answer IN ('yes','partly','help')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE patient_feedback_improvements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 source_checkin_id uuid REFERENCES patient_checkins(id) ON DELETE SET NULL,
 title text NOT NULL, assigned_to uuid NOT NULL REFERENCES staff_users(id), due_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE patient_feedback_delivery (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 checkin_id uuid NOT NULL REFERENCES patient_checkins(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('initial','reminder')), provider_id uuid,
 state text NOT NULL DEFAULT 'prepared', detail text, delivered_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(checkin_id,kind)
);
CREATE TABLE patient_feedback_settings (
 clinic_id uuid PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false, channel_id uuid, template_id text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['patient_feedback_responses','patient_feedback_events','patient_feedback_links','patient_feedback_resolutions','patient_feedback_improvements','patient_feedback_delivery','patient_feedback_settings'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY clinic_isolation ON %I USING(clinic_id=app_clinic_id()) WITH CHECK(clinic_id=app_clinic_id())',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO sahayak_app',t);
 END LOOP;
END $$;
CREATE INDEX ON patient_feedback_events(checkin_id,created_at);
