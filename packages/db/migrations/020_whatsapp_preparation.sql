ALTER TABLE clinic_whatsapp_setup ADD COLUMN channel_id uuid;
ALTER TABLE clinic_whatsapp_setup ADD COLUMN channel_app_id uuid;
ALTER TABLE clinic_whatsapp_setup ADD COLUMN preparation text NOT NULL DEFAULT 'NOT_PREPARED' CHECK(preparation IN ('NOT_PREPARED','PREPARING','WEBHOOK_PENDING','READY','ACTIVE'));
CREATE UNIQUE INDEX clinic_whatsapp_channel ON clinic_whatsapp_setup(channel_id) WHERE channel_id IS NOT NULL;
