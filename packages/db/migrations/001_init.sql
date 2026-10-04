-- Sahayak core schema. Every tenant table carries clinic_id and is protected by RLS.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sahayak_app') THEN
    -- Dev default password; real deployments override via secrets management.
    CREATE ROLE sahayak_app LOGIN PASSWORD 'sahayak_app' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

CREATE TABLE clinics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  default_language text NOT NULL DEFAULT 'en' CHECK (default_language IN ('en','hi')),
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clinic_settings (
  clinic_id uuid PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  address text,
  directions text,
  phone text,
  timings jsonb NOT NULL DEFAULT '{}',          -- {"mon":"09:00-13:00,17:00-20:00", ...}
  avg_consult_minutes int NOT NULL DEFAULT 10,
  intake_questions jsonb NOT NULL DEFAULT '[]', -- [{id, en, hi}]
  modules jsonb NOT NULL DEFAULT '{"checkin":true,"queue":true,"appointments":true,"followups":true,"leads":true}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE doctors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name text NOT NULL,
  speciality text,
  slot_minutes int NOT NULL DEFAULT 15,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE staff_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('doctor','receptionist')),
  doctor_id uuid REFERENCES doctors(id)
);

CREATE TABLE patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text NOT NULL,                          -- E.164, e.g. +919810012345
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en','hi')),
  year_of_birth int,                            -- minimal data: year only
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, phone)
);

CREATE TABLE consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('visit_data','whatsapp_messaging','reminders_followups')),
  notice_version text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz
);

CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES doctors(id),
  patient_id uuid REFERENCES patients(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked','checked_in','completed','cancelled','no_show','needs_rebooking')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','whatsapp','walk_in','agent')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON appointments (clinic_id, doctor_id, starts_at);
-- No double booking of an active slot for one doctor.
CREATE UNIQUE INDEX appointments_no_double_book ON appointments (doctor_id, starts_at)
  WHERE status IN ('booked','checked_in');

CREATE TABLE queue_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES doctors(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  appointment_id uuid REFERENCES appointments(id),
  queue_date date NOT NULL,
  token_number int NOT NULL,
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting','called','in_consultation','done','skipped','on_hold','no_show','cancelled')),
  position_key bigint NOT NULL,                 -- ordering key; only staff/queue tools change it
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  called_at timestamptz,
  finished_at timestamptz,
  UNIQUE (clinic_id, queue_date, token_number)
);
CREATE INDEX ON queue_entries (clinic_id, queue_date, doctor_id, status);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES patients(id),
  channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','voice','web')),
  contact text NOT NULL,                        -- phone number of the other side
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en','hi')),
  state jsonb NOT NULL DEFAULT '{}',            -- orchestrator state (active agent, intake progress...)
  handled_by text NOT NULL DEFAULT 'agent' CHECK (handled_by IN ('agent','human')),
  human_user_id uuid REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, channel, contact)
);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  sender text NOT NULL,                         -- 'patient' | 'agent:<name>' | 'staff:<id>' | 'system'
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON messages (conversation_id, created_at);

-- Append-only audit log of every agent message, tool call and decision.
CREATE TABLE agent_actions (
  id bigserial PRIMARY KEY,
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid,
  conversation_id uuid,
  agent text NOT NULL,                          -- 'checkin','queue','staff','system',...
  kind text NOT NULL,                           -- 'tool_call','message','decision','red_flag','error'
  tool text,
  input jsonb,
  output jsonb,
  ok boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON agent_actions (clinic_id, created_at);

-- Clinics may ADD phrases; the built-in list lives in code and cannot be removed here.
CREATE TABLE red_flag_phrases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  phrase text NOT NULL,
  language text NOT NULL CHECK (language IN ('en','hi')),
  UNIQUE (clinic_id, phrase)
);

CREATE TABLE flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id),
  patient_id uuid REFERENCES patients(id),
  kind text NOT NULL CHECK (kind IN ('red_flag','medical_question','human_requested','upset','system','other')),
  severity text NOT NULL DEFAULT 'normal' CHECK (severity IN ('normal','urgent')),
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES staff_users(id)
);
CREATE INDEX ON flags (clinic_id, status, created_at);

CREATE TABLE intake_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  queue_entry_id uuid REFERENCES queue_entries(id),
  answers jsonb NOT NULL DEFAULT '[]',          -- [{question, answer}]
  summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Row-level security ----------
-- The API sets app.clinic_id per transaction. Policies compare against it.
CREATE OR REPLACE FUNCTION app_clinic_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.clinic_id', true), '')::uuid $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clinic_settings','doctors','staff_users','patients','consents',
    'appointments','queue_entries','conversations','messages','agent_actions',
    'red_flag_phrases','flags','intake_summaries']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY clinic_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

-- Login must find a staff member before a clinic context exists.
CREATE OR REPLACE FUNCTION auth_lookup_staff(p_email text)
RETURNS TABLE (id uuid, clinic_id uuid, name text, role text, doctor_id uuid, password_hash text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ SELECT id, clinic_id, name, role, doctor_id, password_hash FROM staff_users WHERE email = lower(p_email) $$;

GRANT USAGE ON SCHEMA public TO sahayak_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sahayak_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sahayak_app;
-- Audit log is append-only for the app.
REVOKE UPDATE, DELETE ON agent_actions FROM sahayak_app;
-- Clinics table is public identity info (slug/name) but not writable by the app.
REVOKE INSERT, UPDATE, DELETE ON clinics FROM sahayak_app;
GRANT EXECUTE ON FUNCTION auth_lookup_staff(text) TO sahayak_app;
