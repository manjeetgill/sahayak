-- Where a new patient came from (the ?src= on the link they used). Free text from a fixed pattern, never personal data.
ALTER TABLE patients ADD COLUMN source text CHECK (source IS NULL OR source ~ '^[a-z0-9_-]{1,30}$');
