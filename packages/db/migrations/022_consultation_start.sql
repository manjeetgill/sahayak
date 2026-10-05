ALTER TABLE queue_entries ADD COLUMN consultation_started_at timestamptz;
-- Existing call times are intentionally not backfilled as consultation start times.
