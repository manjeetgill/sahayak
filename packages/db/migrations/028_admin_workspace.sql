-- Separate clinic setup accounts from clinical staff. Existing roles stay unchanged.
ALTER TABLE staff_users DROP CONSTRAINT staff_users_role_check;
ALTER TABLE staff_users ADD CONSTRAINT staff_users_role_check CHECK (role IN ('admin','doctor','receptionist'));

-- New clinics start with an admin login and a doctor directory entry.
-- Keep the original clinic factory for existing integrations/tests; signup uses this wrapper.
CREATE FUNCTION create_clinic_with_admin(p_slug text, p_name text, p_doctor_name text, p_admin_name text, p_email text, p_password_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cid uuid;
BEGIN
  cid := create_clinic(p_slug,p_name,p_doctor_name,p_email,p_password_hash);
  UPDATE staff_users SET role='admin',doctor_id=NULL,name=p_admin_name WHERE clinic_id=cid AND email=lower(p_email);
  RETURN cid;
END $$;
REVOKE ALL ON FUNCTION create_clinic_with_admin(text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_clinic_with_admin(text,text,text,text,text,text) TO sahayak_app;
