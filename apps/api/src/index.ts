import { Hono, type Context } from 'hono'
import { guard, sessionOf } from './guard'
import { z } from 'zod'

type AppEnv = { Bindings: { DB?: D1Database }; Variables: { session: string } }

const app = new Hono<AppEnv>()

app.use('*', guard({ tables: ['signals', 'alerts'], columns: [['signals', 'fired', 'INTEGER']] }))
app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Date.now() - start}ms`)
})

const ASSETS = [
  { id: 'BTCUSDT', symbol: 'BTCUSDT', name: 'Bitcoin / Tether', asset_class: 'crypto', venue: 'demo', demo: true },
  { id: 'ETHUSDT', symbol: 'ETHUSDT', name: 'Ethereum / Tether', asset_class: 'crypto', venue: 'demo', demo: true },
  { id: 'SOLUSDT', symbol: 'SOLUSDT', name: 'Solana / Tether', asset_class: 'crypto', venue: 'demo', demo: true },
  { id: 'XAUUSD', symbol: 'XAUUSD', name: 'Gold / US Dollar', asset_class: 'commodity', venue: 'demo', demo: true },
  { id: 'AAPL', symbol: 'AAPL', name: 'Apple Inc', asset_class: 'stock', venue: 'demo', demo: true },
]

function rsi14(candles: any[]) {
  if (candles.length < 15) return { fired: false, rsi: 0, evidence: 'Insufficient candles' }
  const closes = candles.map(c => c.close)
  const gains: number[] = []
  const losses: number[] = []
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1]
    gains.push(change > 0 ? change : 0)
    losses.push(change < 0 ? -change : 0)
  }
  let avgGain = gains.slice(0, 14).reduce((a, b) => a + b, 0) / 14
  let avgLoss = losses.slice(0, 14).reduce((a, b) => a + b, 0) / 14
  for (let i = 14; i < gains.length; i++) {
    avgGain = (avgGain * 13 + gains[i]) / 14
    avgLoss = (avgLoss * 13 + losses[i]) / 14
  }
  const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  const oversold = rsi < 30
  const overbought = rsi > 70
  return {
    fired: oversold || overbought,
    rule_id: 'rsi14',
    rule_version: '1.0.0',
    trigger_values: { rsi: Math.round(rsi * 100) / 100 },
    inputs_hash: Buffer.from(JSON.stringify(candles.map(c => c.start_utc))).toString('hex').slice(0, 12),
    evidence: `RSI-14 = ${rsi.toFixed(2)} over ${closes.length} candles; ${oversold ? 'oversold (<30)' : overbought ? 'overbought (>70)' : 'neutral'}`
  }
}

function maCross(candles: any[]) {
  const FAST = 5
  const SLOW = 10
  if (candles.length < SLOW + 1) return { fired: false, fast: 0, slow: 0, evidence: `Insufficient candles: ${candles.length} (need ${SLOW + 1}+).` }
  const closes = candles.map(c => c.close)
  const n = closes.length
  const ma = (arr: number[], w: number) => arr.slice(arr.length - w).reduce((a: number, b: number) => a + b, 0) / w
  const fastNow = ma(closes.slice(0, n - 1), FAST)
  const slowNow = ma(closes.slice(0, n - 1), SLOW)
  const fastPrev = ma(closes.slice(0, n - 2), FAST)
  const slowPrev = ma(closes.slice(0, n - 2), SLOW)
  const crossedUp = fastPrev <= slowPrev && fastNow > slowNow
  const crossedDown = fastPrev >= slowPrev && fastNow < slowNow
  return {
    fired: crossedUp || crossedDown,
    rule_id: 'ma-cross',
    rule_version: '1.0.0',
    trigger_values: { fast_ma: Math.round(fastNow * 100) / 100, slow_ma: Math.round(slowNow * 100) / 100 },
    inputs_hash: Buffer.from(JSON.stringify(candles.map(c => c.start_utc))).toString('hex').slice(0, 12),
    evidence: `Fast MA(${FAST}) = ${fastNow.toFixed(2)}, Slow MA(${SLOW}) = ${slowNow.toFixed(2)}; ${crossedUp ? 'bullish crossover' : crossedDown ? 'bearish crossdown' : 'no cross'}`
  }
}

const RULES: Record<string, (candles: any[]) => any> = { rsi14, 'ma-cross': maCross }

async function parseBody(c: Context): Promise<any> {
  try {
    const body = await c.req.raw.json()
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) return body
    return {}
  } catch (e) { return {} }
}

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', mode: 'cloudflare', utc: new Date().toISOString() })
})

app.get('/api/assets', (c) => {
  return c.json(ASSETS)
})

app.get('/api/candles', async (c) => {
  const asset = c.req.query('asset') || 'BTCUSDT'
  const limit = Math.min(Number(c.req.query('limit')) || 30, 1000)

  let candles: any[] = []
  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${asset}&interval=1m&limit=${limit}`)
    if (res.ok) {
      const binanceData = (await res.json()) as any[]
      candles = binanceData.map((row: any) => ({
        asset_id: asset,
        timeframe: '1m',
        start_utc: new Date(row[0]).toISOString(),
        open: parseFloat(row[1]),
        high: parseFloat(row[2]),
        low: parseFloat(row[3]),
        close: parseFloat(row[4]),
        volume: parseFloat(row[5]),
        provider: 'binance',
        received_utc: new Date().toISOString(),
        delayed_seconds: Math.floor((Date.now() - row[6]) / 1000),
        stale: false,
        rights_tag: 'public'
      }))
    }
  } catch (err) { /* fall back */ }

  if (candles.length === 0) {
    const base = asset === 'BTCUSDT' ? 100000 : asset === 'ETHUSDT' ? 3500 : asset === 'SOLUSDT' ? 180 : asset === 'XAUUSD' ? 2650 : 180
    const closes: number[] = []
    for (let i = 0; i < limit; i++) {
      if (i < 10) closes.push(base + i * 50)
      else if (i < 20) closes.push(base + 500 - (i - 10) * 40)
      else closes.push(base + 100 - (i - 20) * 60)
    }
    const now = Date.now()
    candles = closes.map((close, i) => {
      const open = i === 0 ? closes[i] : closes[i - 1]
      return {
        asset_id: asset,
        timeframe: '1m',
        start_utc: new Date(now - (limit - i) * 60000).toISOString(),
        open,
        high: Math.max(open, close) + 10,
        low: Math.min(open, close) - 10,
        close,
        volume: 10 + i,
        provider: 'demo-fixture',
        received_utc: new Date(now - (limit - i) * 60000).toISOString(),
        delayed_seconds: 0,
        stale: false,
        rights_tag: 'demo'
      }
    })
  }
  return c.json(candles)
})

app.post('/api/signals/evaluate', async (c) => {
  const body = await parseBody(c) as { asset_id: string; rule_id: string; limit?: number }
  const { asset_id, rule_id, limit = 30 } = body
  const rule = RULES[rule_id]
  if (!rule) return c.json({ error: 'unknown rule' }, 400)

  let candles: any[] = []
  let provider = 'demo-fixture'

  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${asset_id}&interval=1m&limit=${Math.min(limit, 1000)}`)
    if (res.ok) {
      const binanceData = (await res.json()) as any[]
      candles = binanceData.map((row: any) => ({
        asset_id,
        timeframe: '1m',
        start_utc: new Date(row[0]).toISOString(),
        open: parseFloat(row[1]),
        high: parseFloat(row[2]),
        low: parseFloat(row[3]),
        close: parseFloat(row[4]),
        volume: parseFloat(row[5]),
        provider: 'binance',
        received_utc: new Date().toISOString(),
        delayed_seconds: Math.floor((Date.now() - row[6]) / 1000),
        stale: false,
        rights_tag: 'public'
      }))
      provider = 'binance'
    }
  } catch (err) { /* fall back to demo */ }

  if (candles.length === 0) {
    const base = asset_id === 'BTCUSDT' ? 100000 : asset_id === 'ETHUSDT' ? 3500 : asset_id === 'SOLUSDT' ? 180 : asset_id === 'XAUUSD' ? 2650 : 180
    const closes: number[] = []
    for (let i = 0; i < limit; i++) {
      if (i < 10) closes.push(base + i * 50)
      else if (i < 20) closes.push(base + 500 - (i - 10) * 40)
      else closes.push(base + 100 - (i - 20) * 60)
    }
    const now = Date.now()
    candles = closes.map((close, i) => {
      const open = i === 0 ? closes[i] : closes[i - 1]
      return {
        asset_id,
        timeframe: '1m',
        start_utc: new Date(now - (limit - i) * 60000).toISOString(),
        open,
        high: Math.max(open, close) + 10,
        low: Math.min(open, close) - 10,
        close,
        volume: 10 + i,
        provider: 'demo-fixture',
        received_utc: new Date(now - (limit - i) * 60000).toISOString(),
        delayed_seconds: 0,
        stale: false,
        rights_tag: 'demo'
      }
    })
  }

  const stale = candles.some((cand) => cand.stale)
  const result = rule(candles)

  try {
    if (c.env.DB) {
      await c.env.DB.prepare(
        `INSERT INTO signals (signal_id, rule_id, rule_version, asset_id, trigger_values, inputs_hash, fired_utc, evidence, stale, session_id, fired) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        `${rule_id}:${asset_id}:${result.inputs_hash}`,
        result.rule_id,
        result.rule_version,
        asset_id,
        JSON.stringify(result.trigger_values),
        result.inputs_hash,
        new Date().toISOString(),
        result.evidence,
        stale ? 1 : 0,
        sessionOf(c),
        result.fired ? 1 : 0
      ).run()
    }
  } catch (e) { console.error('D1 error:', e) }

  return c.json({ ...result, fired: result.fired, stale, provider, evidence: result.evidence })
})

app.get('/api/signals', async (c) => {
  try {
    if (c.env.DB) {
      const result = await c.env.DB.prepare(`SELECT * FROM signals WHERE session_id=? ORDER BY fired_utc DESC LIMIT 50`).bind(sessionOf(c)).all()
      return c.json(result.results || [])
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json([])
})

app.post('/api/alerts/preview', async (c) => {
  const body = await parseBody(c) as { signal_id: string; channel?: string }
  const { signal_id, channel = 'preview' } = body
  const alert = {
    id: `alert:${crypto.randomUUID()}`,
    signal_id,
    channel,
    idempotency_key: `alert:${signal_id}:${channel}`,
    delivery_status: 'preview',
    created_utc: new Date().toISOString()
  }
  try {
    if (c.env.DB) {
      await c.env.DB.prepare(
        `INSERT INTO alerts (alert_id, signal_id, channel, idempotency_key, delivery_status, created_utc, session_id) VALUES (?,?,?,?,?,?,?)`
      ).bind(alert.id, alert.signal_id, alert.channel, alert.idempotency_key, alert.delivery_status, alert.created_utc, sessionOf(c)).run()
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json(alert, 201)
})

app.get('/api/alerts', async (c) => {
  try {
    if (c.env.DB) {
      const result = await c.env.DB.prepare(`SELECT * FROM alerts WHERE session_id=? ORDER BY created_utc DESC LIMIT 50`).bind(sessionOf(c)).all()
      return c.json(result.results || [])
    }
  } catch (e) { console.error('D1 error:', e) }
  return c.json([])
})

app.post('/api/replay-run', async (c) => {
  const body = await parseBody(c) as { asset_id?: string; rule_id?: string; limit?: number }
  const { asset_id = 'BTCUSDT', rule_id = 'rsi14', limit = 30 } = body
  const rule = RULES[rule_id]
  if (!rule) return c.json({ error: 'unknown rule' }, 400)

  let candles: any[] = []

  try {
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${asset_id}&interval=1m&limit=${Math.min(limit, 1000)}`)
    if (res.ok) {
      const binanceData = (await res.json()) as any[]
      candles = binanceData.map((row: any) => ({
        asset_id,
        timeframe: '1m',
        start_utc: new Date(row[0]).toISOString(),
        open: parseFloat(row[1]),
        high: parseFloat(row[2]),
        low: parseFloat(row[3]),
        close: parseFloat(row[4]),
        volume: parseFloat(row[5]),
        provider: 'binance',
        received_utc: new Date().toISOString(),
        delayed_seconds: Math.floor((Date.now() - row[6]) / 1000),
        stale: false,
        rights_tag: 'public'
      }))
    }
  } catch (err) { /* fall back to demo */ }

  if (candles.length === 0) {
    const base = asset_id === 'BTCUSDT' ? 100000 : asset_id === 'ETHUSDT' ? 3500 : asset_id === 'SOLUSDT' ? 180 : asset_id === 'XAUUSD' ? 2650 : 180
    const closes: number[] = []
    for (let i = 0; i < limit; i++) {
      if (i < 10) closes.push(base + i * 50)
      else if (i < 20) closes.push(base + 500 - (i - 10) * 40)
      else closes.push(base + 100 - (i - 20) * 60)
    }
    const now = Date.now()
    candles = closes.map((close, i) => {
      const open = i === 0 ? closes[i] : closes[i - 1]
      return {
        asset_id,
        timeframe: '1m',
        start_utc: new Date(now - (limit - i) * 60000).toISOString(),
        open,
        high: Math.max(open, close) + 10,
        low: Math.min(open, close) - 10,
        close,
        volume: 10 + i,
        provider: 'demo-fixture',
        received_utc: new Date(now - (limit - i) * 60000).toISOString(),
        delayed_seconds: 0,
        stale: false,
        rights_tag: 'demo'
      }
    })
  }

  const result = rule(candles)
  return c.json({
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

app.get('/api/provider-status', (c) => {
  return c.json({
    provider: 'binance',
    baseUrl: 'https://api.binance.com/api/v3',
    status: 'demo',
    lastSuccess: null,
    lastError: null,
    lastChecked: new Date().toISOString()
  })
})

app.get('/api/provider-health', async (c) => {
  try {
    const res = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1')
    if (!res.ok) throw new Error(`Binance API ${res.status}`)
    await res.json()
    return c.json({ status: 'healthy', lastSuccess: new Date().toISOString(), lastError: null, lastChecked: new Date().toISOString() })
  } catch (err) {
    return c.json({ error: 'live data unavailable', details: (err as Error).message }, 503)
  }
})

export default app
