import { useState, useEffect } from 'react'

const API = import.meta.env.VITE_API_BASE || ''

type Asset = { id: string; symbol: string; name: string; asset_class: string; venue: string; demo: boolean }
type Candle = { start_utc: string; open: number; high: number; low: number; close: number; volume: number; provider: string; delayed_seconds: number; stale: boolean; rights_tag: string }
type Signal = { id: string; rule_id: string; rule_version: string; asset_id: string; trigger_values: string; inputs_hash: string; fired_utc: string; evidence: string; fired: boolean }
type Alert = { id: string; signal_id: string; channel: string; idempotency_key: string; delivery_status: string; created_utc: string }

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }

export default function App() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [selected, setSelected] = useState<string>('')
  const [candles, setCandles] = useState<Candle[]>([])
  const [signals, setSignals] = useState<Signal[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadAssets()
  }, [])

  async function loadAssets() {
    const r = await fetch(`${API}/api/assets`)
    setAssets(await r.json())
  }

  async function loadCandles() {
    if (!selected) return
    const r = await fetch(`${API}/api/candles?asset=${encodeURIComponent(selected)}&limit=30`)
    const data = await r.json()
    setCandles(Array.isArray(data) ? data : [])
  }

  async function evaluate() {
    if (!selected) return
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`${API}/api/signals/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_id: selected, rule_id: 'rsi14' })
      })
      const data = await r.json()
      setResult(data)
      if (!data.stale) {
        await delay(300)
        loadSignals()
        loadAlerts()
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  async function replay() {
    if (!selected) return
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`${API}/api/replay-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_id: selected, rule_id: 'rsi14' })
      })
      setResult(await r.json())
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  async function loadSignals() {
    const r = await fetch(`${API}/api/signals`)
    setSignals(await r.json())
  }

  async function loadAlerts() {
    const r = await fetch(`${API}/api/alerts`)
    setAlerts(await r.json())
  }

  async function previewAlert() {
    if (!result || !result.signal_id) return
    const r = await fetch(`${API}/api/alerts/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signal_id: result.signal_id, channel: 'preview' })
    })
    setAlerts([await r.json(), ...alerts])
  }

  useEffect(() => {
    if (selected) loadCandles()
  }, [selected])

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 980, margin: '0 auto', padding: 20 }}>
      <h1>MarketMesh AI <span style={{ color: '#666', fontSize: 0.6 }}>• demo data</span></h1>
      <p style={{ color: '#555' }}>Unified market intelligence & explainable, rule-based signals. All data is labeled synthetic/demo unless a live provider is configured.</p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <select value={selected} onChange={e => setSelected(e.target.value)} style={{ padding: 8 }}>
          <option value="">Select asset</option>
          {assets.map(a => (
            <option key={a.id} value={a.id}>
              {a.symbol} — {a.name} ({a.asset_class}) {a.demo ? <span style={{ color: '#999' }}>[demo]</span> : ''}
            </option>
          ))}
        </select>
        <button onClick={loadCandles} disabled={!selected} style={{ padding: '8px 14px' }}>Load candles</button>
        <button onClick={evaluate} disabled={!selected || loading} style={{ padding: '8px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          {loading ? 'Evaluating…' : 'Evaluate RSI-14'}
        </button>
        <button onClick={replay} disabled={!selected || loading} style={{ padding: '8px 14px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Replay run</button>
        {error && <span style={{ color: '#dc2626', marginLeft: 8 }}>{error}</span>}
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
              <div style={{ marginBottom: 4 }}><b>Trigger values:</b> {JSON.stringify(result.trigger_values)}</div>
              <div style={{ marginBottom: 4 }}><b>Inputs hash:</b> {result.inputs_hash}</div>
              <div style={{ marginBottom: 4 }}><b>Evidence:</b> {result.evidence}</div>
              <button onClick={previewAlert} disabled={!result.signal_id || result.stale} style={{ marginTop: 8, padding: '6px 12px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                Preview alert (n8n)
              </button>
            </div>
          ) : <p>Evaluate a rule to see the signal.</p>}
        </section>
      </div>

      <section style={{ marginTop: 24 }}>
        <h2>Signal history</h2>
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
        <h2>Alert history (idempotent previews)</h2>
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
        Demo only. No live order execution, wallets, or broker connections. Labeled synthetic data; see docs/data-rights.md.
      </p>
    </div>
  )
}
