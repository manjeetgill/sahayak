ALTER TABLE clinic_settings
  ADD COLUMN solo_availability text NOT NULL DEFAULT 'seeing_patients'
    CHECK (solo_availability IN ('available', 'seeing_patients', 'closed')),
  ADD COLUMN solo_availability_updated_at timestamptz NOT NULL DEFAULT now();
