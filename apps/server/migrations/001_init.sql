-- מגיע לי – initial schema. Money is integer agorot everywhere.

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164       text NOT NULL UNIQUE,
  display_name     text,
  locale           text NOT NULL DEFAULT 'he',
  onboarding_step  text NOT NULL DEFAULT 'family',
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164   text NOT NULL,
  purpose      text NOT NULL CHECK (purpose IN ('login', 'member_consent')),
  member_id    uuid,
  code_hash    text NOT NULL,
  expires_at   timestamptz NOT NULL,
  attempts     int NOT NULL DEFAULT 0,
  consumed_at  timestamptz,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_challenges_phone_idx ON otp_challenges (phone_e164, purpose, created_at DESC);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

CREATE TABLE households (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid NOT NULL UNIQUE REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE members (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id        uuid NOT NULL REFERENCES households(id),
  user_id             uuid REFERENCES users(id),
  full_name           text NOT NULL,
  relation            text NOT NULL CHECK (relation IN ('self', 'spouse', 'child', 'parent', 'other')),
  birth_date          date,
  consent_status      text NOT NULL DEFAULT 'not_required'
                      CHECK (consent_status IN ('not_required', 'pending', 'granted', 'revoked')),
  consent_phone_e164  text,
  consent_granted_at  timestamptz,
  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX members_household_idx ON members (household_id) WHERE deleted_at IS NULL;

-- ---------- coverage catalog ----------

CREATE TABLE payers (
  id                   text PRIMARY KEY,
  name_he              text NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('shaban', 'insurer')),
  claims_email         text,
  app_deep_link        text,
  web_url              text,
  avg_processing_days  int NOT NULL DEFAULT 30
);

CREATE TABLE plans (
  id         text PRIMARY KEY,
  payer_id   text NOT NULL REFERENCES payers(id),
  name_he    text NOT NULL,
  plan_kind  text NOT NULL CHECK (plan_kind IN ('shaban', 'private_individual', 'private_group')),
  active     boolean NOT NULL DEFAULT true
);

CREATE TABLE catalog_versions (
  id            serial PRIMARY KEY,
  published_at  timestamptz NOT NULL DEFAULT now(),
  notes         text
);

CREATE TABLE benefits (
  id               serial PRIMARY KEY,
  catalog_version  int NOT NULL REFERENCES catalog_versions(id),
  plan_id          text NOT NULL REFERENCES plans(id),
  category         text NOT NULL,
  rule             jsonb NOT NULL,
  source_note      text,
  UNIQUE (catalog_version, plan_id, category)
);

CREATE TABLE enrollments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id             uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  plan_id               text NOT NULL REFERENCES plans(id),
  is_shaban_supplement  boolean NOT NULL DEFAULT false,
  policy_number_enc     text,
  source                text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'har_habituach', 'document')),
  valid_from            date NOT NULL DEFAULT '2000-01-01',
  valid_to              date,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, plan_id)
);

-- ---------- documents & receipts ----------

CREATE TABLE documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    uuid NOT NULL REFERENCES households(id),
  member_id       uuid REFERENCES members(id),
  kind            text NOT NULL CHECK (kind IN ('receipt', 'visit_summary', 'referral', 'payer_payment_proof', 'policy', 'other')),
  storage_key     text NOT NULL UNIQUE,
  wrapped_key     text NOT NULL,
  mime_type       text NOT NULL,
  size_bytes      int NOT NULL,
  sha256          text NOT NULL,
  uploaded_by     uuid NOT NULL REFERENCES users(id),
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_household_idx ON documents (household_id);

CREATE TABLE receipts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id       uuid NOT NULL REFERENCES households(id),
  document_id        uuid NOT NULL UNIQUE REFERENCES documents(id),
  member_id          uuid REFERENCES members(id),
  extraction_status  text NOT NULL DEFAULT 'pending'
                     CHECK (extraction_status IN ('pending', 'processing', 'done', 'failed', 'manual')),
  extracted          jsonb,
  confirmed_at       timestamptz,
  category           text,
  provider_name      text,
  service_date       date,
  amount_agorot      int CHECK (amount_agorot IS NULL OR amount_agorot > 0),
  sessions           int NOT NULL DEFAULT 1 CHECK (sessions > 0),
  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX receipts_household_idx ON receipts (household_id, created_at DESC) WHERE deleted_at IS NULL;

-- ---------- claims ----------

CREATE TABLE claims (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id           uuid NOT NULL REFERENCES households(id),
  member_id              uuid NOT NULL REFERENCES members(id),
  status                 text NOT NULL CHECK (status IN ('draft', 'awaiting_documents', 'ready', 'in_progress',
                                                         'completed', 'partially_paid', 'rejected', 'cancelled')),
  is_retro               boolean NOT NULL DEFAULT false,
  privacy_private        boolean NOT NULL DEFAULT false,
  catalog_version        int NOT NULL REFERENCES catalog_versions(id),
  category               text NOT NULL,
  provider_name          text,
  service_date           date NOT NULL,
  sessions               int NOT NULL,
  amount_agorot          int NOT NULL CHECK (amount_agorot > 0),
  routing                jsonb NOT NULL,
  total_expected_agorot  int NOT NULL DEFAULT 0,
  total_paid_agorot      int NOT NULL DEFAULT 0,
  submitted_at           timestamptz,
  created_by             uuid NOT NULL REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX claims_household_idx ON claims (household_id, created_at DESC);

CREATE TABLE claim_receipts (
  claim_id    uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  receipt_id  uuid NOT NULL UNIQUE REFERENCES receipts(id),
  PRIMARY KEY (claim_id, receipt_id)
);

CREATE TABLE claim_legs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id            uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  seq                 int NOT NULL,
  payer_id            text NOT NULL REFERENCES payers(id),
  plan_id             text NOT NULL REFERENCES plans(id),
  status              text NOT NULL CHECK (status IN ('blocked', 'ready', 'submitted', 'received', 'in_review', 'approved',
                                                      'partially_approved', 'rejected', 'paid', 'skipped')),
  base_agorot         int NOT NULL,
  expected_agorot     int NOT NULL,
  approved_agorot     int,
  paid_agorot         int,
  submission_channel  text NOT NULL CHECK (submission_channel IN ('user_handoff', 'email_poa')),
  submitted_at        timestamptz,
  decided_at          timestamptz,
  paid_at             timestamptz,
  payer_reference     text,
  rejection_reason    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (claim_id, seq)
);
CREATE INDEX claim_legs_status_idx ON claim_legs (status);

CREATE TABLE claim_required_docs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id     uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  status       text NOT NULL CHECK (status IN ('missing', 'provided', 'waived')),
  document_id  uuid REFERENCES documents(id),
  UNIQUE (claim_id, kind)
);

CREATE TABLE claim_events (
  id           bigserial PRIMARY KEY,
  claim_id     uuid NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  leg_id       uuid REFERENCES claim_legs(id) ON DELETE CASCADE,
  type         text NOT NULL,
  from_status  text,
  to_status    text,
  actor        text NOT NULL CHECK (actor IN ('user', 'system', 'ops')),
  actor_id     text,
  payload      jsonb,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX claim_events_claim_idx ON claim_events (claim_id, at);

-- ---------- money ----------

CREATE TABLE payment_methods (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id),
  provider            text NOT NULL,
  provider_token_enc  text NOT NULL,
  brand               text,
  last4               text,
  is_default          boolean NOT NULL DEFAULT true,
  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fees (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id            uuid NOT NULL UNIQUE REFERENCES claims(id),
  household_id        uuid NOT NULL REFERENCES households(id),
  rate_bps            int NOT NULL,
  cap_agorot          int NOT NULL,
  base_agorot         int NOT NULL,
  amount_agorot       int NOT NULL,
  status              text NOT NULL CHECK (status IN ('pending', 'scheduled', 'charged', 'disputed', 'waived', 'failed', 'refunded')),
  scheduled_for       timestamptz,
  charged_at          timestamptz,
  provider_charge_id  text,
  failure_reason      text,
  dispute_reason      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------- notifications, consents, audit, jobs ----------

CREATE TABLE push_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expo_token    text NOT NULL UNIQUE,
  platform      text NOT NULL,
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  data        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  read_at     timestamptz
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE consents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  version     text NOT NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  evidence    jsonb
);

CREATE TABLE audit_log (
  id             bigserial PRIMARY KEY,
  actor_user_id  uuid,
  actor_kind     text NOT NULL CHECK (actor_kind IN ('user', 'system', 'ops')),
  action         text NOT NULL,
  entity         text NOT NULL,
  entity_id      text,
  ip             text,
  meta           jsonb,
  at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id            bigserial PRIMARY KEY,
  type          text NOT NULL,
  payload       jsonb NOT NULL,
  run_at        timestamptz NOT NULL DEFAULT now(),
  attempts      int NOT NULL DEFAULT 0,
  max_attempts  int NOT NULL DEFAULT 3,
  locked_at     timestamptz,
  locked_by     text,
  last_error    text,
  done_at       timestamptz,
  failed_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_due_idx ON jobs (run_at) WHERE done_at IS NULL AND failed_at IS NULL;
