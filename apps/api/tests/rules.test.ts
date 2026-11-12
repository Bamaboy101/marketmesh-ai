import { describe, it, expect } from 'vitest'
import { rsi14, maCross } from '../src/rules'

const ascending = Array.from({ length: 30 }, (_, i) => ({ close: 100 + i, start_utc: `2026-11-01T00:${String(i).padStart(2,'0')}:00Z` }))

describe('rsi14 rule', () => {
  it('rejects insufficient candles', async () => {
    const out = await rsi14({ candles: ascending.slice(0, 5), asset_id: 'X' })
    expect(out.fired).toBe(false)
    expect(out.evidence).toContain('Insufficient')
  })

  it('is deterministic: same input => same output', async () => {
    const a = await rsi14({ candles: ascending, asset_id: 'X' })
    const b = await rsi14({ candles: ascending, asset_id: 'X' })
    expect(a).toEqual(b)
  })

  it('detects oversold after a sharp decline', async () => {
    const candles: Array<{ close: number; start_utc: string }> = []
    for (let i = 0; i < 20; i++) candles.push({ close: 100 + i * 10, start_utc: `2026-11-01T00:${String(i).padStart(2,'0')}:00Z` })
    for (let i = 0; i < 15; i++) candles.push({ close: 300 - i * 15, start_utc: `2026-11-01T00:${String(20 + i).padStart(2,'0')}:00Z` })
    const out = await rsi14({ candles, asset_id: 'X' })
    expect(out.fired).toBe(true)
    expect(out.trigger_values.rsi).toBeLessThan(30)
  })
})

describe('ma-cross rule', () => {
  it('rejects insufficient candles', async () => {
    const out = await maCross({ candles: ascending.slice(0, 5), asset_id: 'X' })
    expect(out.fired).toBe(false)
  })

  it('is deterministic', async () => {
    const a = await maCross({ candles: ascending, asset_id: 'X' })
    const b = await maCross({ candles: ascending, asset_id: 'X' })
    expect(a).toEqual(b)
  })

  it('detects bullish crossover', async () => {
    // downtrend then sharp upturn -> fast MA crosses above slow MA
    const closes = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 20, 30]
    const candles = closes.map((c, i) => ({ close: c, start_utc: `2026-11-01T00:${String(i).padStart(2,'0')}:00Z` }))
    const out = await maCross({ candles, asset_id: 'X' })
    expect(out.fired).toBe(true)
  })
})
