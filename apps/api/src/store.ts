import Database from 'better-sqlite3'
import { resolve } from 'path'

const DB_PATH = process.env.MARKETMESH_DB_PATH || resolve(process.cwd(), 'marketmesh.db')
export const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')

export interface Candle {
  asset_id: string
  timeframe: string
  start_utc: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  provider: string
  received_utc: string
  delayed_seconds: number
  stale: boolean
  rights_tag: string
}

export interface Asset {
  id: string
  symbol: string
  name: string
  asset_class: string
  venue: string
  demo: boolean
}

export interface Signal {
  id: string
  rule_id: string
  rule_version: string
  asset_id: string
  trigger_values: string
  inputs_hash: string
  fired_utc: string
  evidence: string
}

export interface Alert {
  id: string
  signal_id: string
  channel: string
  idempotency_key: string
  delivery_status: string
  created_utc: string
}

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
      rights_tag TEXT NOT NULL DEFAULT 'demo'
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
      created_utc TEXT NOT NULL
    );
  `)
}

export function seed(db: Database.Database): void {
  const assets: Asset[] = [
    { id: 'BTCUSDT', symbol: 'BTCUSDT', name: 'Bitcoin / Tether', asset_class: 'crypto', venue: 'demo', demo: true },
    { id: 'ETHUSDT', symbol: 'ETHUSDT', name: 'Ethereum / Tether', asset_class: 'crypto', venue: 'demo', demo: true },
    { id: 'XAUUSD', symbol: 'XAUUSD', name: 'Gold / US Dollar', asset_class: 'commodity', venue: 'demo', demo: true },
    { id: 'AAPL', symbol: 'AAPL', name: 'Apple Inc', asset_class: 'stock', venue: 'demo', demo: true },
  ]

  const insertAsset = db.prepare(
    'INSERT OR IGNORE INTO assets (id, symbol, name, asset_class, venue, demo) VALUES (?,?,?,?,?,?)'
  )
  for (const a of assets) {
    insertAsset.run(a.id, a.symbol, a.name, a.asset_class, a.venue, a.demo ? 1 : 0)
  }
}

export function listAssets(db: Database.Database): Asset[] {
  return db.prepare('SELECT * FROM assets ORDER BY asset_class, symbol').all() as Asset[]
}

export function getLatestCandles(db: Database.Database, assetId: string, limit: number): Candle[] {
  return db.prepare(
    `SELECT * FROM candles WHERE asset_id = ? ORDER BY start_utc DESC LIMIT ?`
  ).all(assetId, limit) as Candle[]
}

export function insertSignal(db: Database.Database, signal: Signal): void {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO signals (id, rule_id, rule_version, asset_id, trigger_values, inputs_hash, fired_utc, evidence)
     VALUES (?,?,?,?,?,?,?,?)`
  )
  stmt.run(
    signal.id, signal.rule_id, signal.rule_version, signal.asset_id,
    signal.trigger_values, signal.inputs_hash, signal.fired_utc, signal.evidence
  )
}

export function listSignals(db: Database.Database, limit = 50): Signal[] {
  return db.prepare(
    `SELECT * FROM signals ORDER BY fired_utc DESC LIMIT ?`
  ).bind(limit).all() as Signal[]
}

export function insertAlert(db: Database.Database, alert: Alert): void {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO alerts (id, signal_id, channel, idempotency_key, delivery_status, created_utc)
     VALUES (?,?,?,?,?,?)`
  )
  stmt.run(
    alert.id, alert.signal_id, alert.channel, alert.idempotency_key,
    alert.delivery_status, alert.created_utc
  )
}

export function listAlerts(db: Database.Database, limit = 50): Alert[] {
  return db.prepare(
    `SELECT * FROM alerts ORDER BY created_utc DESC LIMIT ?`
  ).bind(limit).all() as Alert[]
}
