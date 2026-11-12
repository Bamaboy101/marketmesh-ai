import type { Database } from 'better-sqlite3'

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

export function seed(db: Database.Database) {
  const assets: Asset[] = [
    { id: 'BTCUSDT', symbol: 'BTCUSDT', name: 'Bitcoin / Tether', asset_class: 'crypto', venue: 'demo', demo: 1 },
    { id: 'ETHUSDT', symbol: 'ETHUSDT', name: 'Ethereum / Tether', asset_class: 'crypto', venue: 'demo', demo: 1 },
    { id: 'XAUUSD', symbol: 'XAUUSD', name: 'Gold / US Dollar', asset_class: 'commodity', venue: 'demo', demo: 1 },
    { id: 'AAPL', symbol: 'AAPL', name: 'Apple Inc', asset_class: 'stock', venue: 'demo', demo: 1 }
  ]

  const insertAsset = db.prepare(
    'INSERT OR IGNORE INTO assets (id, symbol, name, asset_class, venue, demo) VALUES (?,?,?,?,?,?)'
  )
  for (const a of assets) insertAsset.run(a.id, a.symbol, a.name, a.asset_class, a.venue, a.demo ? 1 : 0)

  // Deterministic BTCUSDT fixture: 30 one-minute candles.
  // Prices trend up then down to produce an RSI-14 oversold condition near the end.
  const base = 100000
  const closes: number[] = []
  for (let i = 0; i < 30; i++) {
    if (i < 10) closes.push(base + i * 50)          // uptrend
    else if (i < 20) closes.push(base + 500 - (i - 10) * 40) // slight down
    else closes.push(base + 100 - (i - 20) * 60)    // sharper down -> oversold
  }

  const insertCandle = db.prepare(
    `INSERT INTO candles (asset_id, timeframe, start_utc, open, high, low, close, volume, provider, received_utc, delayed_seconds, stale, rights_tag)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )

  const now = Date.now()
  for (let i = 0; i < closes.length; i++) {
    const close = closes[i]
    const open = i === 0 ? closes[i] : closes[i - 1]
    const high = Math.max(open, close) + 10
    const low = Math.min(open, close) - 10
    const start = new Date(now - (closes.length - i) * 60_000).toISOString()
    insertCandle.run(
      'BTCUSDT', '1m', start, open, high, low, close, 10 + i,
      'demo-fixture', new Date(now - (closes.length - i) * 60_000).toISOString(),
      0, 0, 'demo'
    )
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

export function insertSignal(db: Database.Database, signal: Signal) {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO signals (id, rule_id, rule_version, asset_id, trigger_values, inputs_hash, fired_utc, evidence)
     VALUES (?,?,?,?,?,?,?,?)`
  )
  return stmt.run(
    signal.id, signal.rule_id, signal.rule_version, signal.asset_id,
    signal.trigger_values, signal.inputs_hash, signal.fired_utc, signal.evidence
  )
}

export function listSignals(db: Database.Database, limit = 50): Signal[] {
  return db.prepare(
    'SELECT * FROM signals ORDER BY fired_utc DESC LIMIT ?'
  ).all(limit) as Signal[]
}

export function insertAlert(db: Database.Database, alert: Alert) {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO alerts (id, signal_id, channel, idempotency_key, delivery_status, created_utc)
     VALUES (?,?,?,?,?,?)`
  )
  return stmt.run(
    alert.id, alert.signal_id, alert.channel, alert.idempotency_key,
    alert.delivery_status, alert.created_utc
  )
}

export function listAlerts(db: Database.Database, limit = 50): Alert[] {
  return db.prepare(
    'SELECT * FROM alerts ORDER BY created_utc DESC LIMIT ?'
  ).all(limit) as Alert[]
}
