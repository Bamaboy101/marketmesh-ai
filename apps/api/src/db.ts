import Database from 'better-sqlite3'
import { resolve } from 'path'

const DB_PATH = process.env.MARKETMESH_DB_PATH || resolve(process.cwd(), 'marketmesh.db')

export const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      asset_class TEXT NOT NULL,
      venue TEXT NOT NULL,
      demo INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS candles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id TEXT NOT NULL,
      timeframe TEXT NOT NULL DEFAULT '1m',
      start_utc TEXT NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      provider TEXT NOT NULL,
      received_utc TEXT NOT NULL,
      delayed_seconds INTEGER NOT NULL DEFAULT 0,
      stale INTEGER NOT NULL DEFAULT 0,
      rights_tag TEXT NOT NULL DEFAULT 'demo',
      FOREIGN KEY (asset_id) REFERENCES assets(id)
    );
    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      rule_version TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      trigger_values TEXT NOT NULL,
      inputs_hash TEXT NOT NULL,
      fired_utc TEXT NOT NULL,
      evidence TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      signal_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      delivery_status TEXT NOT NULL DEFAULT 'preview',
      created_utc TEXT NOT NULL,
      FOREIGN KEY (signal_id) REFERENCES signals(id)
    );
  `)
}
