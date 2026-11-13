export interface RuleInput {
  candles: Array<{ close: number; start_utc: string }>
  asset_id: string
}

export interface RuleOutput {
  fired: boolean
  rule_id: string
  rule_version: string
  trigger_values: Record<string, number>
  inputs_hash: string
  evidence: string
}

export function rsi14(input: RuleInput): any {
  const { candles } = input
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

export function maCross(input: RuleInput): any {
  const { candles } = input
  const FAST = 5
  const SLOW = 10
  if (candles.length < SLOW + 1) return { fired: false, fast: 0, slow: 0, evidence: `Insufficient candles: ${candles.length} (need ${SLOW + 1}+).` }
  const closes = candles.map(c => c.close)
  const n = closes.length
  const ma = (arr: number[], w: number) => arr.slice(arr.length - w).reduce((a, b) => a + b, 0) / w
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

export const RULES = { rsi14, 'ma-cross': maCross }
