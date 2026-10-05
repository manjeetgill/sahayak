ALTER TABLE care_plans ADD COLUMN template_start_at timestamptz;
CREATE FUNCTION protect_care_template_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.title IS DISTINCT FROM OLD.title OR NEW.steps IS DISTINCT FROM OLD.steps OR NEW.family_id IS DISTINCT FROM OLD.family_id OR NEW.version IS DISTINCT FROM OLD.version THEN
  RAISE EXCEPTION 'Template content is versioned: create a new version';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER care_template_version_guard BEFORE UPDATE ON care_templates FOR EACH ROW EXECUTE FUNCTION protect_care_template_version();
