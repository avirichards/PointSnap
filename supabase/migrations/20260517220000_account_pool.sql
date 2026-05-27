-- Account pool for per-program scraper credentials.
--
-- Each row = one airline account (free or paid). The Python worker rotates
-- through active accounts per program, throttles per account, and auto-marks
-- banned ones so they're skipped next time.
--
-- The credentials themselves live in Fly secrets, keyed by a naming
-- convention: {PROGRAM_PREFIX}_ACCOUNT_{N}_USER + _PASS. This row tracks
-- the metadata (which account slot exists, when last used, whether banned),
-- not the secrets themselves. Keeps the DB clean of plain-text creds and
-- piggybacks on Fly's secret-rotation primitives.

CREATE TABLE IF NOT EXISTS account_pool (
  id              text PRIMARY KEY,             -- e.g. "BA_ACCOUNT_1"
  program_id      varchar(32) NOT NULL REFERENCES programs(id),
  account_index   smallint NOT NULL,            -- 1, 2, 3, ... per program
  env_user_var    text NOT NULL,                -- "BA_ACCOUNT_1_USER"
  env_pass_var    text NOT NULL,                -- "BA_ACCOUNT_1_PASS"
  status          varchar(16) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','banned','exhausted','disabled')),
  balance_miles   integer,                       -- last-known mile balance (LH cares)
  last_used_at    timestamptz,
  searches_today  integer NOT NULL DEFAULT 0,
  hourly_window_start timestamptz NOT NULL DEFAULT now(),
  banned_at       timestamptz,
  ban_reason      text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, account_index)
);

-- Fast rotation lookup: per-program, ordered by least-recently-used active accounts.
CREATE INDEX IF NOT EXISTS account_pool_program_status_idx
  ON account_pool (program_id, status, last_used_at NULLS FIRST);

-- Quick admin view: count active vs banned per program.
CREATE INDEX IF NOT EXISTS account_pool_status_idx ON account_pool (status);

GRANT SELECT, INSERT, UPDATE, DELETE ON account_pool TO service_role;

NOTIFY pgrst, 'reload schema';
