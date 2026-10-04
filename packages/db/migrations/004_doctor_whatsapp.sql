-- One WhatsApp number per doctor (optional). A message to a doctor's number books with that doctor.
ALTER TABLE doctors ADD COLUMN whatsapp_number text UNIQUE;
ALTER TABLE conversations ADD COLUMN doctor_id uuid REFERENCES doctors(id);

DROP FUNCTION IF EXISTS clinic_for_whatsapp_number(text);
CREATE FUNCTION clinic_for_whatsapp_number(p_number text) RETURNS TABLE (clinic_id uuid, doctor_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS
$$ SELECT d.clinic_id, d.id FROM doctors d WHERE d.whatsapp_number = p_number AND d.active
   UNION ALL
   SELECT s.clinic_id, NULL::uuid FROM clinic_settings s WHERE s.whatsapp_number = p_number
   LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION clinic_for_whatsapp_number(text) TO sahayak_app;
