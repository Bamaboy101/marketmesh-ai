CREATE TABLE IF NOT EXISTS candles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  start_utc TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL,
  provider TEXT NOT NULL,
  received_utc TEXT NOT NULL,
  delayed_seconds INTEGER DEFAULT 0,
  stale INTEGER DEFAULT 0,
  rights_tag TEXT DEFAULT 'demo',
  UNIQUE(asset_id, timeframe, start_utc)
);

CREATE TABLE IF NOT EXISTS signals (
  signal_id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  rule_version TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  trigger_values TEXT NOT NULL,
  inputs_hash TEXT NOT NULL,
  fired_utc TEXT NOT NULL,
  evidence TEXT NOT NULL,
  stale INTEGER DEFAULT 0,
  session_id TEXT,
  fired INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS alerts (
  alert_id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'preview',
  idempotency_key TEXT NOT NULL UNIQUE,
  delivery_status TEXT NOT NULL DEFAULT 'preview',
  created_utc TEXT NOT NULL
);
