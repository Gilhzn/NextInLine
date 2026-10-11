-- What the family pays for each policy, per month (from Har HaBituach or entered by the user). Used only to show
-- premiums next to the refunds a policy actually returned – information, never a recommendation.
ALTER TABLE enrollments ADD COLUMN monthly_premium_agorot int CHECK (monthly_premium_agorot IS NULL OR monthly_premium_agorot >= 0);
