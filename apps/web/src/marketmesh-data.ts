type Asset = { id: string; symbol: string; name: string; asset_class: string; venue: string; demo: boolean }
type Candle = { start_utc: string; open: number; high: number; low: number; close: number; volume: number; provider: string; delayed_seconds: number; stale: boolean; rights_tag: string }

const ASSETS: Asset[] = [
  { id: 'BTCUSDT', symbol: 'BTCUSDT', name: 'Bitcoin / Tether', asset_class: 'crypto', venue: 'demo', demo: true },
  { id: 'ETHUSDT', symbol: 'ETHUSDT', name: 'Ethereum / Tether', asset_class: 'crypto', venue: 'demo', demo: true },
  { id: 'XAUUSD', symbol: 'XAUUSD', name: 'Gold / US Dollar', asset_class: 'commodity', venue: 'demo', demo: true },
  { id: 'AAPL', symbol: 'AAPL', name: 'Apple Inc', asset_class: 'stock', venue: 'demo', demo: true }
]

function generateCandles(assetId: string): Candle[] {
  const closes: number[] = []
  const base = assetId === 'BTCUSDT' ? 100000 : assetId === 'ETHUSDT' ? 3500 : assetId === 'XAUUSD' ? 2650 : 180
  for (let i = 0; i < 30; i++) {
    if (i < 10) closes.push(base + i * 50)
    else if (i < 20) closes.push(base + 500 - (i - 10) * 40)
    else closes.push(base + 100 - (i - 20) * 60)
  }
  const now = Date.now()
  return closes.map((close, i) => {
    const open = i === 0 ? closes[i] : closes[i - 1]
    return {
      id: `c${i}`, asset_id: assetId, timeframe: '1m',
      start_utc: new Date(now - (30 - i) * 60_000).toISOString(),
      open, high: Math.max(open, close) + 10, low: Math.min(open, close) - 10, close, volume: 10 + i,
      provider: 'demo-fixture', received_utc: new Date().toISOString(), delayed_seconds: 0, stale: false, rights_tag: 'demo'
    }
  })
}

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  const hash = Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return hash
}

function mean(values: number[]): number { return values.reduce((a, b) => a + b, 0) / values.length }

export { Asset, Candle, ASSETS, generateCandles, sha256, mean }