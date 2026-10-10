-- How sure we are of each catalog value, and per-policy overrides entered by the user.
ALTER TABLE benefits
  ADD COLUMN confidence text NOT NULL DEFAULT 'unverified'
    CHECK (confidence IN ('official', 'secondary', 'unverified'));

ALTER TABLE plans ADD COLUMN description text;

-- { "<category>": <rule> | null } – the user's own policy terms; null = "my policy doesn't cover this".
ALTER TABLE enrollments ADD COLUMN custom_benefits jsonb NOT NULL DEFAULT '{}'::jsonb;
