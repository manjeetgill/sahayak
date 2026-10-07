-- Gateway records are system-authored; retain the actor for manual money entries.
ALTER TABLE clinic_charges ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE clinic_payments ALTER COLUMN recorded_by DROP NOT NULL;
ALTER TABLE clinic_payments ADD COLUMN source text NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','razorpay'));
ALTER TABLE clinic_payments ADD COLUMN provider_payment_id text;
ALTER TABLE clinic_payments ADD CONSTRAINT payment_record_author CHECK(recorded_by IS NOT NULL OR (source='razorpay' AND provider_payment_id IS NOT NULL));
ALTER TABLE clinic_qr_settings ADD COLUMN online_payment_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE qr_payment_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
 arrival_id uuid UNIQUE REFERENCES qr_arrivals(id) ON DELETE SET NULL,
 key_id text NOT NULL, provider_order_id text, provider_payment_id text,
 amount_paise integer NOT NULL CHECK(amount_paise>=100), currency text NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
 state text NOT NULL DEFAULT 'creating' CHECK(state IN ('creating','ready','unknown','captured','review')),
 charge_id uuid REFERENCES clinic_charges(id) ON DELETE SET NULL,
 detail text, verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(key_id,provider_order_id), UNIQUE(key_id,provider_payment_id)
);
ALTER TABLE qr_payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_payment_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY clinic_isolation ON qr_payment_orders USING(clinic_id=app_clinic_id()) WITH CHECK(clinic_id=app_clinic_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON qr_payment_orders TO sahayak_app;
CREATE INDEX ON qr_payment_orders(clinic_id,created_at);
