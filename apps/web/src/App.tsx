import { useState, useEffect } from 'react'
import { ASSETS, generateCandles, sha256 } from './marketmesh-data'

type Candle = { start_utc: string; open: number; high: number; low: number; close: number; volume: number; provider: string; delayed_seconds: number; stale: boolean; rights_tag: string }
type Signal = { id: string; rule_id: string; rule_version: string; asset_id: string; trigger_values: string; inputs_hash: string; fired_utc: string; evidence: string; fired: boolean }
type Alert = { id: string; signal_id: string; channel: string; idempotency_key: string; delivery_status: string; created_utc: string }

function rsi14(candles: Candle[]): { fired: boolean; rsi: number; evidence: string } {
  if (candles.length < 15) return { fired: false, rsi: 0, evidence: 'Insufficient candles' }
  const closes = candles.map(c => c.close)
  const gains: number[] = [], losses: number[] = []
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1]
    gains.push(change > 0 ? change : 0)
    losses.push(change < 0 ? -change : 0)
  }
  let avgGain = mean(gains.slice(0, 14)), avgLoss = mean(losses.slice(0, 14))
  for (let i = 14; i < gains.length; i++) {
    avgGain = (avgGain * 13 + gains[i]) / 14
    avgLoss = (avgLoss * 13 + losses[i]) / 14
  }
  const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  const oversold = rsi < 30, overbought = rsi > 70
  return { fired: oversold || overbought, rsi: Math.round(rsi * 100) / 100, evidence: `RSI-14 = ${rsi.toFixed(2)} — ${oversold ? 'oversold (<30)' : overbought ? 'overbought (>70)' : 'neutral'}` }
}

function maCross(candles: Candle[]): { fired: boolean; fast: number; slow: number; evidence: string } {
  const FAST = 5, SLOW = 10
  if (candles.length < SLOW + 1) return { fired: false, fast: 0, slow: 0, evidence: 'Insufficient candles' }
  const closes = candles.map(c => c.close)
  const n = closes.length
  const ma = (arr: number[], w: number) => mean(arr.slice(arr.length - w))
  const fastNow = ma(closes.slice(0, n - 1), FAST), slowNow = ma(closes.slice(0, n - 1), SLOW)
  const fastPrev = ma(closes.slice(0, n - 2), FAST), slowPrev = ma(closes.slice(0, n - 2), SLOW)
  const crossedUp = fastPrev <= slowPrev && fastNow > slowNow
  const crossedDown = fastPrev >= slowPrev && fastNow < slowNow
  return { fired: crossedUp || crossedDown, fast: Math.round(fastNow * 100) / 100, slow: Math.round(slowNow * 100) / 100, evidence: crossedUp ? 'bullish crossover' : crossedDown ? 'bearish crossdown' : 'no cross' }
}

function mean(values: number[]): number { return values.reduce((a, b) => a + b, 0) / values.length }

export default function App() {
  const [selected, setSelected] = useState<string>('BTCUSDT')
  const [candles, setCandles] = useState<Candle[]>([])
  const [signals, setSignals] = useState<Signal[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setCandles(generateCandles(selected))
  }, [selected])

  async function evaluateRule(ruleId: string) {
    if (!selected) return
    setLoading(true); setError(null)
    try {
      const cs = candles.slice().reverse()
      let resultData: any = null
      if (ruleId === 'rsi14') {
        const out = rsi14(cs)
        resultData = {
          id: `rsi14:${selected}:${await sha256(JSON.stringify(cs.map(c => c.start_utc)))}`,
          rule_id: 'rsi14', rule_version: '1.0.0', asset_id: selected,
          trigger_values: JSON.stringify({ rsi: out.rsi }),
          inputs_hash: await sha256(JSON.stringify(cs.map(c => c.start_utc))),
          fired_utc: new Date().toISOString(), evidence: out.evidence, fired: out.fired
        }
      } else if (ruleId === 'ma-cross') {
        const out = maCross(cs)
        resultData = {
          id: `ma-cross:${selected}:${await sha256(JSON.stringify(cs.map(c => c.start_utc)))}`,
          rule_id: 'ma-cross', rule_version: '1.0.0', asset_id: selected,
          trigger_values: JSON.stringify({ fast_ma: out.fast, slow_ma: out.slow }),
          inputs_hash: await sha256(JSON.stringify(cs.map(c => c.start_utc))),
          fired_utc: new Date().toISOString(), evidence: out.evidence, fired: out.fired
        }
      }
      setResult(resultData)
      if (!resultData.stale) {
        setSignals([resultData, ...signals])
        const alert: Alert = {
          id: `alert:${Date.now()}`, signal_id: resultData.id, channel: 'preview',
          idempotency_key: `alert:${resultData.id}:preview`, delivery_status: 'preview', created_utc: new Date().toISOString()
        }
        setAlerts([alert, ...alerts])
      }
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  async function replayRun() {
    if (!selected) return
    setLoading(true)
    try {
      const cs = candles.slice().reverse()
      const out = rsi14(cs)
      const replayData = {
        asset_id: selected, rule_id: 'rsi14', rule_version: '1.0.0', fired: out.fired,
        trigger_values: { rsi: out.rsi }, inputs_hash: await sha256(JSON.stringify(cs.map(c => c.start_utc))),
        evidence: out.evidence, utc: new Date().toISOString()
      }
      setResult(replayData)
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  function previewAlert() {
    if (!result || !result.signal_id) return
    const alert: Alert = {
      id: `alert:${Date.now()}`, signal_id: result.signal_id, channel: 'preview',
      idempotency_key: `alert:${result.signal_id}:preview`, delivery_status: 'preview', created_utc: new Date().toISOString()
    }
    setAlerts([alert, ...alerts])
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 980, margin: '0 auto', padding: 20 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 20, borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ width: 40, height: 40, background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 800, fontSize: 18 }}>MM</div>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>MarketMesh AI</h1>
          <p style={{ margin: 0, color: '#666', fontSize: 13 }}>Unified market intelligence & explainable signals</p>
          <span style={{ display: 'inline-block', marginTop: 6, padding: '2px 8px', border: '1px solid #3b82f6', borderRadius: 10, fontSize: 11, color: '#3b82f6' }}>Demo data</span>
        </div>
      </header>

      {error && <span style={{ color: '#dc2626', marginBottom: 12 }}>{error}</span>}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <select value={selected} onChange={e => setSelected(e.target.value)} style={{ padding: 8 }}>
          {ASSETS.map(a => (
            <option key={a.id} value={a.id}>{a.symbol} — {a.name} ({a.asset_class}) {a.demo ? ' [demo]' : ''}</option>
          ))}
        </select>
        <button onClick={() => evaluateRule('rsi14')} disabled={loading || !selected} style={{ padding: '8px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          {loading ? 'Evaluating…' : 'Evaluate RSI-14'}
        </button>
        <button onClick={() => evaluateRule('ma-cross')} disabled={loading || !selected} style={{ padding: '8px 14px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Evaluate MA-Cross</button>
        <button onClick={replayRun} disabled={loading || !selected} style={{ padding: '8px 14px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Replay Run</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <section>
          <h2>Candles ({selected})</h2>
          {candles.length === 0 ? <p>No data.</p> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6 }}>Time (UTC)</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc', padding: 6 }}>Open</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc', padding: 6 }}>High</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc', padding: 6 }}>Low</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc', padding: 6 }}>Close</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc', padding: 6 }}>Vol</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc', padding: 6 }}>Provider</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc', padding: 6 }}>Delay</th>
                </tr>
              </thead>
              <tbody>
                {candles.slice().reverse().map(c => (
                  <tr key={c.start_utc} style={{ borderBottom: c.stale ? '1px solid #fca5a5' : '1px solid #e5e7eb' }}>
                    <td style={{ padding: 4, fontSize: 0.85 }}>{new Date(c.start_utc).toLocaleString()}</td>
                    <td style={{ padding: 4, fontSize: 0.85, textAlign: 'right' }}>{c.open.toFixed(2)}</td>
                    <td style={{ padding: 4, fontSize: 0.85, textAlign: 'right' }}>{c.high.toFixed(2)}</td>
                    <td style={{ padding: 4, fontSize: 0.85, textAlign: 'right' }}>{c.low.toFixed(2)}</td>
                    <td style={{ padding: 4, fontSize: 0.85, textAlign: 'right' }}>{c.close.toFixed(2)}</td>
                    <td style={{ padding: 4, fontSize: 0.85, textAlign: 'right' }}>{c.volume.toFixed(0)}</td>
                    <td style={{ padding: 4, fontSize: 0.85, textAlign: 'right' }}>{c.provider}</td>
                    <td style={{ padding: 4, fontSize: 0.85, textAlign: 'right', color: c.stale ? '#dc2626' : '#666' }}>{c.stale ? 'STALE' : c.delayed_seconds + 's'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2>Signal</h2>
          {result ? (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: result.stale ? '#fef2f2' : '#f0fdf4' }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{result.rule_id} v{result.rule_version}</div>
              <div style={{ marginBottom: 4 }}><b>Fired:</b> {String(result.fired)}</div>
              <div style={{ marginBottom: 4 }}><b>Stale data suppressed:</b> {String(result.stale)}</div>
              <div style={{ marginBottom: 4 }}><b>Trigger values:</b> {result.trigger_values}</div>
              <div style={{ marginBottom: 4 }}><b>Inputs hash:</b> {result.inputs_hash}</div>
              <div style={{ marginBottom: 4 }}><b>Evidence:</b> {result.evidence}</div>
              <button onClick={previewAlert} disabled={!result.signal_id || result.stale} style={{ marginTop: 8, padding: '6px 12px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                Preview Alert (n8n)
              </button>
            </div>
          ) : <p>Evaluate a rule to see the signal.</p>}
        </section>
      </div>

      <section style={{ marginTop: 24 }}>
        <h2>Signal History</h2>
        {signals.length === 0 ? <p>No signals yet.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6 }}>Time (UTC)</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6 }}>Rule</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6 }}>Asset</th>
                <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc', padding: 6 }}>Fired</th>
              </tr>
            </thead>
            <tbody>
              {signals.map(s => (
                <tr key={s.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 4, fontSize: 0.85 }}>{new Date(s.fired_utc).toLocaleString()}</td>
                  <td style={{ padding: 4, fontSize: 0.85 }}>{s.rule_id}</td>
                  <td style={{ padding: 4, fontSize: 0.85 }}>{s.asset_id}</td>
                  <td style={{ padding: 4, fontSize: 0.85, textAlign: 'right' }}>{String(s.fired)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Alert History (Idempotent Previews)</h2>
        {alerts.length === 0 ? <p>No alerts yet.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6 }}>Time (UTC)</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6 }}>Signal</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: 6 }}>Channel</th>
                <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc', padding: 6 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map(a => (
                <tr key={a.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 4, fontSize: 0.85 }}>{new Date(a.created_utc).toLocaleString()}</td>
                  <td style={{ padding: 4, fontSize: 0.85 }}>{a.signal_id}</td>
                  <td style={{ padding: 4, fontSize: 0.85 }}>{a.channel}</td>
                  <td style={{ padding: 4, fontSize: 0.85, textAlign: 'right' }}>{a.delivery_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p style={{ marginTop: 32, color: '#888', fontSize: 0.85 }}>
        Demo only. No live order execution, wallets, or broker connections. Labeled synthetic data.
      </p>
    </div>
  )
}