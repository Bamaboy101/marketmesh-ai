import React, { useState, useEffect } from 'react'
import { Laptop, Shield, BarChart3, Globe } from 'lucide-react'

const API_BASE = 'https://marketmesh-api.marketmesh-api.workers.dev'

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } })
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`)
  return res.json()
}

function AssetRow({ asset, onSelect, selectedId }) {
  return (
    <tr onClick={() => onSelect(asset)} className={`cursor-pointer px-4 py-3 border-b hover:bg-gray-50 ${selectedId === asset.id ? 'bg-blue-50 border-blue-200' : ''}`}>
      <td className="font-medium">{asset.name}</td>
      <td className="text-sm text-gray-500">{asset.asset_class}</td>
      <td className="text-sm text-gray-500">{asset.venue}</td>
      <td className="font-mono text-xs">{asset.demo ? 'demo' : 'live'}</td>
    </tr>
  )
}

function App() {
  const [assets, setAssets] = useState([])
  const [candles, setCandles] = useState([])
  const [signals, setSignals] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api('/api/assets').then(setAssets).catch(() => setAssets([
      { id: 'BTCUSDT', symbol: 'BTCUSDT', name: 'Bitcoin / Tether', asset_class: 'crypto', venue: 'demo', demo: true },
      { id: 'ETHUSDT', symbol: 'ETHUSDT', name: 'Ethereum / Tether', asset_class: 'crypto', venue: 'demo', demo: true },
      { id: 'XAUUSD', symbol: 'XAUUSD', name: 'Gold / US Dollar', asset_class: 'commodity', venue: 'demo', demo: true },
      { id: 'AAPL', symbol: 'AAPL', name: 'Apple Inc', asset_class: 'stock', venue: 'demo', demo: true },
    ]))
  }, [])

  const loadCandles = async (id) => {
    setLoading(true)
    try { const d = await api(`/api/candles?asset=${id}&limit=30`); setCandles(d) } catch (e) { console.error(e) }
    setLoading(false)
  }

  const evalSignal = async () => {
    if (!selected) return
    try { const s = await api('/api/signals/evaluate', { method: 'POST', body: JSON.stringify({ asset_id: selected.id, rule_id: 'rsi14', limit: 30 }) }); setSignals(prev => [...prev.filter(x => x.rule_id !== 'rsi14' || x.asset_id !== selected.id), s]) } catch (e) { console.error(e) }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">M</div>
            <span className="font-bold text-xl text-gray-800">MarketMesh AI</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span> Live Demo</span>
          </div>
        </div>
      </nav>
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm border p-4">
              <h2 className="font-bold mb-4">Watchlist</h2>
              <table className="w-full text-sm">
                <tbody>
                  {assets.map(a => <AssetRow key={a.id} asset={a} onSelect={setSelected} selectedId={selected?.id} />)}
                </tbody>
              </table>
            </div>
          </div>
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-sm border p-4">
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-bold">{selected?.name || 'Select an asset'}</h2>
                <div className="flex gap-2">
                  <button onClick={() => selected && loadCandles(selected.id)} disabled={loading || !selected} className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 disabled:opacity-50">{loading ? 'Loading...' : 'Refresh'}</button>
                  <button onClick={evalSignal} disabled={loading || !selected} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">Evaluate Signal</button>
                </div>
              </div>
              {loading ? <div className="h-64 flex items-center justify-center text-gray-400">Loading...</div> : (
                <div className="h-64 w-full border rounded-lg p-4 relative bg-white">
                  <svg className="w-full h-full" viewBox={`0 0 ${candles.length * 12} 300`}>
                    {candles.map((c, i) => {
                      const closes = candles.map(c => c.close)
                      const max = Math.max(...closes), min = Math.min(...closes), range = max - min || 1
                      const y = 300 - ((c.close - min) / range) * 260
                      const prev = candles[i - 1]
                      const prevY = prev ? 300 - ((prev.close - min) / range) * 260 : y
                      const color = c.close >= (prev ? prev.close : c.open) ? '#10b981' : '#ef4444'
                      return <g key={i}><line x1={i*12+4} y1={prevY} x2={i*12+8} y2={y} stroke={color} strokeWidth={2} strokeLinecap="round"/><circle cx={i*12+6} cy={y} r={2.5} fill={color}/></g>
                    })}
                  </svg>
                </div>
              )}
            </div>
          </div>
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm border p-4">
              <h2 className="font-bold mb-4">Signal History</h2>
              <div className="space-y-3">
                {signals.length > 0 ? signals.map(s => (
                  <div key={s.inputs_hash} className="p-3 border rounded bg-gray-50">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-medium">{s.rule_id}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${s.fired ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500`}>{s.fired ? 'FIRED' : 'NEUTRAL'}</span>
                    </div>
                    <div className="text-sm text-gray-600">{s.asset_id}</div>
                    <div className="mt-1 text-gray-900">{s.evidence}</div>
                    <div className="mt-1 text-xs text-gray-400">RSI: {s.trigger_values?.rsi?.toFixed?.(2) ?? 'N/A'} • Provider: {s.provider ?? 'demo'}</div>
                  </div>
                )) : <div className="text-center py-8 text-gray-400 text-sm">No signals yet</div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
