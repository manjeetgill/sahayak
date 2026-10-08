CREATE TABLE google_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('calendar','sheets')), refresh_token text NOT NULL,
 target_id text, target_name text, setup_state text NOT NULL DEFAULT 'ready' CHECK(setup_state IN ('ready','creating','unknown')),
 enabled boolean NOT NULL DEFAULT false, next_row integer NOT NULL DEFAULT 2,
 last_error text, last_synced_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(clinic_id,kind)
);
CREATE TABLE google_oauth_requests (
 clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE, nonce text PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('calendar','sheets')), user_id uuid NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
 proof_hash text NOT NULL, verifier text NOT NULL, pending_token text,
 consumed boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 UNIQUE(clinic_id,kind)
);
CREATE TABLE google_sync_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL REFERENCES google_connections(id) ON DELETE CASCADE,
 appointment_id uuid NOT NULL, row_number integer NOT NULL, payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','synced','failed')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error text, synced_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(connection_id,appointment_id), UNIQUE(connection_id,row_number)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['google_connections','google_oauth_requests','google_sync_items'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY clinic_isolation ON %I USING(clinic_id=app_clinic_id()) WITH CHECK(clinic_id=app_clinic_id())',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO sahayak_app',t);
 END LOOP;
END $$;
CREATE FUNCTION queue_google_appointment(c uuid,a uuid,d uuid,s timestamptz,e timestamptz,st text,only_connection uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE conn record; n integer; body jsonb;
BEGIN
 body=jsonb_build_object('appointmentId',a,'doctorId',d,'startsAt',s,'endsAt',e,'status',st);
 FOR conn IN SELECT id FROM google_connections WHERE clinic_id=c AND target_id IS NOT NULL AND (only_connection IS NULL OR id=only_connection) ORDER BY id FOR UPDATE LOOP
  SELECT row_number INTO n FROM google_sync_items WHERE connection_id=conn.id AND appointment_id=a;
  IF n IS NULL THEN
   UPDATE google_connections SET next_row=next_row+1 WHERE id=conn.id RETURNING next_row-1 INTO n;
  END IF;
  INSERT INTO google_sync_items(clinic_id,connection_id,appointment_id,row_number,payload)
  VALUES(c,conn.id,a,n,body) ON CONFLICT(connection_id,appointment_id) DO UPDATE SET payload=excluded.payload,status='pending',attempts=0,next_attempt_at=now(),last_error=NULL,updated_at=now();
 END LOOP;
END $$;
CREATE FUNCTION google_appointment_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  PERFORM queue_google_appointment(OLD.clinic_id,OLD.id,OLD.doctor_id,OLD.starts_at,OLD.ends_at,'deleted'); RETURN OLD;
 END IF;
 PERFORM queue_google_appointment(NEW.clinic_id,NEW.id,NEW.doctor_id,NEW.starts_at,NEW.ends_at,NEW.status); RETURN NEW;
END $$;
CREATE TRIGGER google_appointment_sync AFTER INSERT OR UPDATE OF starts_at,ends_at,status,doctor_id OR DELETE ON appointments FOR EACH ROW EXECUTE FUNCTION google_appointment_changed();
CREATE FUNCTION due_google_connections() RETURNS TABLE(id uuid,clinic_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT c.id,c.clinic_id FROM google_connections c WHERE c.enabled AND c.target_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM google_sync_items i WHERE i.connection_id=c.id AND i.status='pending' AND i.next_attempt_at<=now()) ORDER BY c.last_synced_at NULLS FIRST LIMIT 50
$$;
REVOKE ALL ON FUNCTION due_google_connections() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION due_google_connections() TO sahayak_app;
