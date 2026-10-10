-- Hosted-page card setup (the card is typed on the payment provider's page; we receive a token only).
CREATE TABLE payment_setups (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id),
  provider           text NOT NULL,
  provider_ref       text,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  failure_reason     text,
  payment_method_id  uuid REFERENCES payment_methods(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz
);
CREATE INDEX payment_setups_user ON payment_setups (user_id, created_at DESC);

ALTER TABLE payment_methods ADD COLUMN exp_month int, ADD COLUMN exp_year int;

-- Tax document (קבלה / חשבונית מס קבלה) issued by the provider with the charge, and refunds.
ALTER TABLE fees
  ADD COLUMN document_number text,
  ADD COLUMN document_url text,
  ADD COLUMN refunded_at timestamptz,
  ADD COLUMN provider_refund_id text;

-- Each definitive charge attempt gets its own idempotency key (fee id + attempt), so a declined charge can be
-- retried with a new card while a timed-out request is retried with the same key.
ALTER TABLE fees ADD COLUMN charge_attempts int NOT NULL DEFAULT 0;
