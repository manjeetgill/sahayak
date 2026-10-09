ALTER TABLE clinic_settings
  ADD COLUMN workspace_mode text NOT NULL DEFAULT 'full'
  CHECK (workspace_mode IN ('solo', 'full'));
