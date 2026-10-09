-- Doctor choices and explicit patient permission for repeated evening messages.
ALTER TABLE doctor_feedback_preferences
  ADD COLUMN waiting_question_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN evening_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN evening_nights integer NOT NULL DEFAULT 3 CHECK (evening_nights BETWEEN 1 AND 3),
  ADD COLUMN evening_time time NOT NULL DEFAULT '19:00' CHECK (evening_time >= '18:00' AND evening_time < '21:00');
ALTER TABLE doctor_feedback_preferences DROP CONSTRAINT doctor_feedback_preferences_delay_days_check;
ALTER TABLE doctor_feedback_preferences ADD CONSTRAINT doctor_feedback_preferences_delay_days_check
  CHECK (delay_days BETWEEN -1 AND 30);
ALTER TABLE doctor_feedback_preferences ALTER COLUMN delay_days SET DEFAULT -1;

ALTER TABLE consents DROP CONSTRAINT consents_purpose_check;
ALTER TABLE consents ADD CONSTRAINT consents_purpose_check
  CHECK (purpose IN ('visit_data','whatsapp_messaging','reminders_followups','evening_checkins'));

ALTER TABLE qr_arrivals ADD COLUMN waiting_answer text CHECK (char_length(waiting_answer) <= 1000);
ALTER TABLE qr_arrivals ADD COLUMN waiting_answered_at timestamptz;

ALTER TABLE follow_ups ADD COLUMN evening_number integer CHECK (evening_number BETWEEN 1 AND 3);
CREATE UNIQUE INDEX follow_ups_evening_visit ON follow_ups(queue_entry_id,evening_number)
  WHERE kind='post_visit' AND evening_number IS NOT NULL;

CREATE TABLE evening_checkin_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  follow_up_id uuid NOT NULL UNIQUE REFERENCES follow_ups(id) ON DELETE CASCADE,
  feeling text NOT NULL CHECK (feeling IN ('better','same','worse','help')),
  message text NOT NULL DEFAULT '' CHECK (char_length(message) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE evening_checkin_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE evening_checkin_replies FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_isolation ON evening_checkin_replies
  USING(clinic_id=app_clinic_id()) WITH CHECK(clinic_id=app_clinic_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON evening_checkin_replies TO sahayak_app;

ALTER TABLE patient_feedback_responses ADD COLUMN experience text
  CHECK (experience IN ('excellent','good','okay','poor'));
ALTER TABLE patient_feedback_responses ADD COLUMN suggestion text NOT NULL DEFAULT ''
  CHECK (char_length(suggestion) <= 1000);
