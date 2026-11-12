import { createHash } from 'crypto'

/**
 * Deterministic market signal rules.
 * Both rules are pure functions over candle arrays. Identical input + version
 * always produces identical output (repeatability requirement).
 */

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

function sha256(input: string): string {
  const buf = Buffer.from(input, 'utf8')
  return createHash('sha256').update(buf).digest('hex')
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** RSI-14 using Wilder's smoothing. version "1.0.0". */
export async function rsi14(input: RuleInput): Promise<RuleOutput> {
  const { candles, asset_id } = input
  if (candles.length < 15) {
    return {
      fired: false,
      rule_id: 'rsi14',
      rule_version: '1.0.0',
      trigger_values: {},
      inputs_hash: sha256(JSON.stringify(candles.map(c => c.start_utc))),
      evidence: `Insufficient candles: ${candles.length} (need 15+).`
    }
  }

  const closes = candles.map(c => c.close)
  const gains: number[] = []
  const losses: number[] = []
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1]
    gains.push(change > 0 ? change : 0)
    losses.push(change < 0 ? -change : 0)
  }

  // Wilder's smoothing: first average = simple average of first 14, then smoothed
  let avgGain = mean(gains.slice(0, 14))
  let avgLoss = mean(losses.slice(0, 14))

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
    inputs_hash: sha256(JSON.stringify(candles.map(c => c.start_utc))),
    evidence: `RSI-14 = ${rsi.toFixed(2)} over ${closes.length} candles; ${oversold ? 'oversold (<30)' : overbought ? 'overbought (>70)' : 'neutral'}`
  }
}

/** Moving-average crossover. Fast over slow. version "1.0.0". */
export async function maCross(input: RuleInput): Promise<RuleOutput> {
  const { candles } = input
  const FAST = 5
  const SLOW = 10
  if (candles.length < SLOW + 1) {
    return {
      fired: false,
      rule_id: 'ma-cross',
      rule_version: '1.0.0',
      trigger_values: {},
      inputs_hash: sha256(JSON.stringify(candles.map(c => c.start_utc))),
      evidence: `Insufficient candles: ${candles.length} (need ${SLOW + 1}+).`
    }
  }

  const closes = candles.map(c => c.close)
  const n = closes.length

  // fast MA over last FAST, slow MA over last SLOW, for current and previous candle
  const ma = (arr: number[], window: number) => mean(arr.slice(arr.length - window))

  const fastNow = ma(closes.slice(0, n - 1), FAST)   // previous closed candle
  const slowNow = ma(closes.slice(0, n - 1), SLOW)
  const fastPrev = ma(closes.slice(0, n - 2), FAST)  // candle before previous
  const slowPrev = ma(closes.slice(0, n - 2), SLOW)

  // crossover: fast was <= slow before, fast > slow now
  const crossedUp = fastPrev <= slowPrev && fastNow > slowNow
  // crossdown: fast was >= slow before, fast < slow now
  const crossedDown = fastPrev >= slowPrev && fastNow < slowNow

  return {
    fired: crossedUp || crossedDown,
    rule_id: 'ma-cross',
    rule_version: '1.0.0',
    trigger_values: {
      fast_ma: Math.round(fastNow * 100) / 100,
      slow_ma: Math.round(slowNow * 100) / 100
    },
    inputs_hash: sha256(JSON.stringify(candles.map(c => c.start_utc))),
    evidence: `Fast MA(${FAST}) = ${fastNow.toFixed(2)}, Slow MA(${SLOW}) = ${slowNow.toFixed(2)}; ${crossedUp ? 'bullish crossover' : crossedDown ? 'bearish crossdown' : 'no cross'}`
  }
}

export const RULES = { rsi14, 'ma-cross': maCross }
