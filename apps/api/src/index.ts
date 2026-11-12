import { randomUUID } from 'crypto'
import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import { z } from 'zod'
import { initDb, db } from './db'
import { seed, listAssets, getLatestCandles, insertSignal, listSignals, insertAlert, listAlerts } from './store'
import { RULES, type RuleInput } from './rules'

const app = express()
const PORT = Number(process.env.PORT) || 4000
const DATA_MODE = process.env.DATA_MODE || 'fixture'

app.use(cors())
app.use(express.json())

// Structured request logging
app.use((_req: Request, _res: Response, next: NextFunction) => {
  const start = Date.now()
  _res.on('finish', () => {
    console.log(`${_req.method} ${_req.originalUrl} ${_res.statusCode} ${Date.now() - start}ms`)
  })
  next()
})

// Health
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', mode: DATA_MODE, utc: new Date().toISOString() })
})

// Assets
app.get('/api/assets', (_req: Request, res: Response) => {
  res.json(listAssets(db))
})

// Candles
const candlesQuery = z.object({ asset: z.string().min(1), limit: z.string().optional().transform(v => Number(v || 30)) })
app.get('/api/candles', (req: Request, res: Response) => {
  const parsed = candlesQuery.safeParse(req.query)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid query', issues: parsed.error.flatten() })
  }
  const { asset, limit } = parsed.data
  const rows = getLatestCandles(db, asset, limit)
  res.json(rows)
})

// Signals (deterministic rule evaluation)
const signalBody = z.object({
  asset_id: z.string().min(1),
  rule_id: z.enum(['rsi14', 'ma-cross']),
  limit: z.string().optional().transform(v => Number(v || 30))
})

app.post('/api/signals/evaluate', async (req: Request, res: Response) => {
  const parsed = signalBody.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid body', issues: parsed.error.flatten() })
  }
  const { asset_id, rule_id, limit } = parsed.data

  const candles = getLatestCandles(db, asset_id, limit).reverse() // chronological
  if (candles.length === 0) {
    return res.status(404).json({ error: `no candles for asset ${asset_id}` })
  }

  const stale = candles.some(c => c.stale)
  const rule = RULES[rule_id]
  if (!rule) {
    return res.status(400).json({ error: `unknown rule ${rule_id}` })
  }

  const result = await rule({ candles, asset_id })
  const signal = {
    id: `${rule_id}:${asset_id}:${result.inputs_hash}`,
    rule_id: result.rule_id,
    rule_version: result.rule_version,
    asset_id,
    trigger_values: JSON.stringify(result.trigger_values),
    inputs_hash: result.inputs_hash,
    fired_utc: new Date().toISOString(),
    evidence: result.evidence
  }

  // Stale data fail-safe: show warning and suppress signal creation when candles are stale
  if (stale) {
    return res.status(200).json({
      fired: false,
      stale: true,
      rule_id: result.rule_id,
      rule_version: result.rule_version,
      trigger_values: result.trigger_values,
      inputs_hash: result.inputs_hash,
      evidence: `${result.evidence} [STALE DATA: signal suppressed]`
    })
  }

  insertSignal(db, signal)
  res.json({ ...signal, fired: result.fired })
})

// Signal history
app.get('/api/signals', (_req: Request, res: Response) => {
  res.json(listSignals(db))
})

// Alert preview (idempotent per signal)
const alertBody = z.object({ signal_id: z.string().min(1), channel: z.string().default('preview') })
app.post('/api/alerts/preview', (req: Request, res: Response) => {
  const parsed = alertBody.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid body', issues: parsed.error.flatten() })
  }
  const { signal_id, channel } = parsed.data
  const idempotency_key = `alert:${signal_id}:${channel}`
  const existing = db.prepare('SELECT * FROM alerts WHERE idempotency_key = ?').get(idempotency_key)
  if (existing) {
    return res.json(existing)
  }
  const alert = {
    id: `alert:${randomUUID()}`,
    signal_id,
    channel,
    idempotency_key,
    delivery_status: 'preview',
    created_utc: new Date().toISOString()
  }
  insertAlert(db, alert)
  res.status(201).json(alert)
})

app.get('/api/alerts', (_req: Request, res: Response) => {
  res.json(listAlerts(db))
})

// Replay run: deterministic fixture evaluation (same fixture + version => identical event)
app.post('/api/replay-run', async (req: Request, res: Response) => {
  const { asset_id = 'BTCUSDT', rule_id = 'rsi14', limit = 30 } = req.body as { asset_id?: string; rule_id?: string; limit?: number }
  const candles = getLatestCandles(db, asset_id, limit).reverse()
  if (candles.length === 0) return res.status(404).json({ error: 'no candles' })
  const rule = RULES[rule_id as keyof typeof RULES]
  if (!rule) return res.status(400).json({ error: 'unknown rule' })
  const result = await rule({ candles, asset_id })
  res.json({
    asset_id,
    rule_id: result.rule_id,
    rule_version: result.rule_version,
    fired: result.fired,
    trigger_values: result.trigger_values,
    inputs_hash: result.inputs_hash,
    evidence: result.evidence,
    utc: new Date().toISOString()
  })
})

// 404
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'not found' })
})

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'internal server error' })
})

initDb()
seed(db)

app.listen(PORT, () => {
  console.log(`MarketMesh API listening on :${PORT} (mode=${DATA_MODE})`)
})

export default app
