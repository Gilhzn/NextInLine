-- Operators sign in to /ops with their own phone (SMS code) instead of a shared token.
ALTER TABLE otp_challenges DROP CONSTRAINT IF EXISTS otp_challenges_purpose_check;
ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_purpose_check
  CHECK (purpose IN ('login', 'member_consent', 'ops_login'));
