import express from 'express'
import cors from 'cors'
import { z } from 'zod'

const app = express()
app.use(cors())
app.use(express.json())

app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`)
  })
  next()
})

const ASSETS = [
  { id: 'BTCUSDT', symbol: 'BTCUSDT', name: 'Bitcoin / Tether', asset_class: 'crypto', venue: 'demo', demo: true },
  { id: 'ETHUSDT', symbol: 'ETHUSDT', name: 'Ethereum / Tether', asset_class: 'crypto', venue: 'demo', demo: true },
  { id: 'XAUUSD', symbol: 'XAUUSD', name: 'Gold / US Dollar', asset_class: 'commodity', venue: 'demo', demo: true },
  { id: 'AAPL', symbol: 'AAPL', name: 'Apple Inc', asset_class: 'stock', venue: 'demo', demo: true },
]

const candlesStore: Map<string, any[]> = new Map()

function generateCandles(assetId: string, count = 30) {
  const base = assetId === 'BTCUSDT' ? 100000 : assetId === 'ETHUSDT' ? 3500 : assetId === 'XAUUSD' ? 2650 : 180
  const closes: number[] = []
  for (let i = 0; i < count; i++) {
    if (i < 10) closes.push(base + i * 50)
    else if (i < 20) closes.push(base + 500 - (i - 10) * 40)
    else closes.push(base + 100 - (i - 20) * 60)
  }
  const now = Date.now()
  return closes.map((close, i) => {
    const open = i === 0 ? closes[i] : closes[i - 1]
    return {
      asset_id: assetId,
      timeframe: '1m',
      start_utc: new Date(now - (count - i) * 60000).toISOString(),
      open,
      high: Math.max(open, close) + 10,
      low: Math.min(open, close) - 10,
      close,
      volume: 10 + i,
      provider: 'demo-fixture',
      received_utc: new Date(now - (count - i) * 60000).toISOString(),
      delayed_seconds: 0,
      stale: false,
      rights_tag: 'demo'
    }
  })
}

for (const asset of ASSETS) {
  candlesStore.set(asset.id, generateCandles(asset.id, 30))
}

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
  let avgGain = gains.slice(0, 14).reduce((a: number, b: number) => a + b, 0) / 14
  let avgLoss = losses.slice(0, 14).reduce((a: number, b: number) => a + b, 0) / 14
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

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', mode: 'demo', utc: new Date().toISOString() })
})

app.get('/api/provider-status', (_req, res) => {
  res.json({
    provider: 'binance',
    baseUrl: 'https://api.binance.com/api/v3',
    status: 'demo',
    lastSuccess: null,
    lastError: null,
    lastChecked: new Date().toISOString()
  })
})

app.get('/api/provider-health', async (_req, res) => {
  try {
    const resp = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1')
    if (!resp.ok) throw new Error(`Binance API ${resp.status}`)
    await resp.json()
    res.json({ status: 'healthy', lastSuccess: new Date().toISOString(), lastError: null, lastChecked: new Date().toISOString() })
  } catch (err) {
    res.status(503).json({ error: 'live data unavailable', details: (err as Error).message })
  }
})

app.get('/api/assets', (_req, res) => {
  res.json(ASSETS)
})

app.get('/api/candles', async (req, res) => {
  const asset = (req.query.asset as string) || 'BTCUSDT'
  const limit = Math.min(Number(req.query.limit) || 30, 1000)

  try {
    const resp = await fetch(`https://api.binance.com/api/v3/klines?symbol=${asset}&interval=1m&limit=${limit}`)
    if (resp.ok) {
      const binanceData = await resp.json()
      const candles = binanceData.map((row: any) => ({
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
      return res.json(candles)
    }
  } catch (err) {
    // fall back to demo
  }

  const allCandles = candlesStore.get(asset) || generateCandles(asset, limit)
  return res.json(allCandles.slice(0, limit))
})

app.post('/api/signals/evaluate', async (req, res) => {
  const body = z.object({ asset_id: z.string(), rule_id: z.string(), limit: z.number().optional() }).safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: 'invalid body' })
  const { asset_id, rule_id, limit = 30 } = body.data
  const rule = RULES[rule_id]
  if (!rule) return res.status(400).json({ error: 'unknown rule' })

  try {
    const resp = await fetch(`https://api.binance.com/api/v3/klines?symbol=${asset_id}&interval=1m&limit=${Math.min(limit, 1000)}`)
    if (!resp.ok) throw new Error(`Binance API ${resp.status}`)
    const binanceData = await resp.json()
    const candles = binanceData.map((row: any) => ({
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
    if (candles.length === 0) return res.status(404).json({ error: `no candles for asset ${asset_id}` })
    const stale = candles.some((cand: any) => cand.stale)
    const result = rule(candles)
    if (stale) {
      return res.json({ ...result, fired: false, stale: true, evidence: `${result.evidence} [STALE DATA: signal suppressed]` })
    }
    return res.json({ ...result, fired: result.fired })
  } catch (err) {
    return res.status(503).json({ error: 'signal evaluation failed', details: (err as Error).message })
  }
})

app.get('/api/signals', (_req, res) => {
  res.json([])
})

app.post('/api/alerts/preview', async (req, res) => {
  const body = z.object({ signal_id: z.string(), channel: z.string().optional() }).safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: 'invalid body' })
  const { signal_id, channel = 'preview' } = body.data
  const alert = {
    id: `alert:${crypto.randomUUID()}`,
    signal_id,
    channel,
    idempotency_key: `alert:${signal_id}:${channel}`,
    delivery_status: 'preview',
    created_utc: new Date().toISOString()
  }
  return res.status(201).json(alert)
})

app.get('/api/alerts', (_req, res) => {
  res.json([])
})

app.post('/api/replay-run', async (req, res) => {
  const body = z.object({ asset_id: z.string().optional(), rule_id: z.string().optional(), limit: z.number().optional() }).safeParse(req.body)
  if (!body.success) return res.status(400).json({ error: 'invalid body' })
  const { asset_id = 'BTCUSDT', rule_id = 'rsi14', limit = 30 } = body.data
  const rule = RULES[rule_id]
  if (!rule) return res.status(400).json({ error: 'unknown rule' })

  try {
    const resp = await fetch(`https://api.binance.com/api/v3/klines?symbol=${asset_id}&interval=1m&limit=${Math.min(limit, 1000)}`)
    if (!resp.ok) throw new Error(`Binance API ${resp.status}`)
    const binanceData = await resp.json()
    const candles = binanceData.map((row: any) => ({
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
    const result = rule(candles)
    return res.json({
      asset_id,
      rule_id: result.rule_id,
      rule_version: result.rule_version,
      fired: result.fired,
      trigger_values: result.trigger_values,
      inputs_hash: result.inputs_hash,
      evidence: result.evidence,
      utc: new Date().toISOString()
    })
  } catch (err) {
    return res.status(503).json({ error: 'replay failed', details: (err as Error).message })
  }
})

app.listen(4001, () => {
  console.log('MarketMesh API listening on http://localhost:4001')
})

export default app
