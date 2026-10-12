-- Receipts by email: each household gets a private address (r-<token>@<inbound domain>).
ALTER TABLE households ADD COLUMN inbox_token text UNIQUE;
ALTER TABLE receipts ADD COLUMN source text NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'email'));

-- What arrived by email, so the family can see it (no body is stored).
CREATE TABLE inbound_emails (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id  uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  from_address  text,
  attachments   int NOT NULL DEFAULT 0,
  receipts      int NOT NULL DEFAULT 0,
  status        text NOT NULL CHECK (status IN ('processed', 'no_attachments', 'rejected')),
  received_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inbound_emails_household_idx ON inbound_emails (household_id, received_at DESC);

-- Open banking: a read-only consent at a licensed financial-information provider. Only medical payments are kept
-- (as payment leads); every other transaction is discarded after classification.
CREATE TABLE bank_connections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        text NOT NULL,
  provider_ref    text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'failed', 'expired', 'revoked')),
  institutions    jsonb NOT NULL DEFAULT '[]',
  expires_at      timestamptz,
  last_synced_at  timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bank_connections_household_idx ON bank_connections (household_id);

ALTER TABLE payment_leads ADD COLUMN source text NOT NULL DEFAULT 'statement' CHECK (source IN ('statement', 'bank'));
