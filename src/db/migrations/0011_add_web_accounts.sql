CREATE TABLE IF NOT EXISTS app_users (
  id text PRIMARY KEY,
  display_name text,
  email text,
  avatar_url text,
  primary_telegram_user_id text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_primary_telegram_user_id
  ON app_users(primary_telegram_user_id);

CREATE INDEX IF NOT EXISTS idx_app_users_email
  ON app_users(email);

CREATE TABLE IF NOT EXISTS user_auth_accounts (
  id text PRIMARY KEY,
  app_user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  email text,
  username text,
  display_name text,
  avatar_url text,
  raw_profile text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CONSTRAINT user_auth_accounts_provider_check CHECK (provider IN ('telegram', 'google'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_auth_accounts_provider_account
  ON user_auth_accounts(provider, provider_account_id);

CREATE INDEX IF NOT EXISTS idx_user_auth_accounts_app_user
  ON user_auth_accounts(app_user_id);

CREATE TABLE IF NOT EXISTS web_sessions (
  id text PRIMARY KEY,
  app_user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_web_sessions_token_hash
  ON web_sessions(token_hash);

CREATE INDEX IF NOT EXISTS idx_web_sessions_app_user
  ON web_sessions(app_user_id);

CREATE INDEX IF NOT EXISTS idx_web_sessions_expires_at
  ON web_sessions(expires_at);
