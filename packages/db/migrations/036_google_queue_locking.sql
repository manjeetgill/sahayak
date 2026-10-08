-- Keep slow Google requests from holding up unrelated new clinic bookings.
-- Stable sheet rows are allocated locally; the delivery worker never takes this allocation lock.
CREATE OR REPLACE FUNCTION queue_google_appointment(c uuid,a uuid,d uuid,s timestamptz,e timestamptz,st text,only_connection uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE conn record; n integer; body jsonb;
BEGIN
 body=jsonb_build_object('appointmentId',a,'doctorId',d,'startsAt',s,'endsAt',e,'status',st);
 FOR conn IN SELECT id FROM google_connections WHERE clinic_id=c AND target_id IS NOT NULL AND (only_connection IS NULL OR id=only_connection) ORDER BY id FOR KEY SHARE LOOP
  SELECT row_number INTO n FROM google_sync_items WHERE connection_id=conn.id AND appointment_id=a;
  IF n IS NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('google-row:'||conn.id::text,0));
   SELECT row_number INTO n FROM google_sync_items WHERE connection_id=conn.id AND appointment_id=a;
   IF n IS NULL THEN SELECT coalesce(max(row_number),1)+1 INTO n FROM google_sync_items WHERE connection_id=conn.id; END IF;
  END IF;
  INSERT INTO google_sync_items(clinic_id,connection_id,appointment_id,row_number,payload)
  VALUES(c,conn.id,a,n,body) ON CONFLICT(connection_id,appointment_id) DO UPDATE SET payload=excluded.payload,status='pending',attempts=0,next_attempt_at=now(),last_error=NULL,updated_at=now();
 END LOOP;
END $$;
ALTER TABLE google_connections DROP COLUMN next_row;
CREATE INDEX google_sync_pending ON google_sync_items(connection_id,next_attempt_at) WHERE status='pending';
