-- Medical payments the user found on a credit card statement and asked us to track until a receipt is added.
-- Only the rows the user confirmed are stored; the statement itself is never kept.
CREATE TABLE payment_leads (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id   uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  merchant       text NOT NULL,
  paid_on        date NOT NULL,
  amount_agorot  int NOT NULL CHECK (amount_agorot > 0),
  category       text,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, merchant, paid_on, amount_agorot)
);
CREATE INDEX payment_leads_household ON payment_leads (household_id, status);
