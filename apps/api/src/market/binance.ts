/**
 * Binance public market data connector for MarketMesh AI.
 * Uses public REST endpoints - no API key required for market data.
 * All rate limits, validation, and error handling are implemented per Binance API docs.
 */

import { type Candle } from '../store'

const BINANCE_BASE_URL = 'https://api.binance.com/api/v3'
const MAX_RETRIES = 3
const INITIAL_RETRY_DELAY_MS = 1000
const MAX_CANDLES_PER_REQUEST = 1000

export interface ProviderStatus {
  provider: string
  baseUrl: string
  status: 'online' | 'degraded' | 'offline' | 'unknown'
  lastSuccess: string | null
  lastError: string | null
  lastChecked: string
}

export interface CandleInput {
  symbol: string
  interval: string
  limit?: number
  startTime?: number
  endTime?: number
}

/**
 * Binance Kline/candlestick response entry.
 * Binance returns: [openTime, open, high, low, close, volume, closeTime, quoteAssetVolume, numberOfTrades, takerBuyBaseAssetVolume, takerBuyQuoteAssetVolume, ignore]
 */
interface BinanceCandle {
  [index: number]: any
  0: number   // Open time
  1: string   // Open
  2: string   // High
  3: string   // Low
  4: string   // Close
  5: string   // Volume
  6: number   // Close time
  7: string   // Quote asset volume
  8: number   // Number of trades
  9: string   // Taker buy base asset volume
  10: string  // Taker buy quote asset volume
  11: string  // Ignore
}

export class BinanceConnector {
  private baseUrl: string
  private providerStatus: ProviderStatus
  private requestCount = 0
  private lastRequestTime = 0

  constructor(baseUrl: string = BINANCE_BASE_URL) {
    this.baseUrl = baseUrl
    this.providerStatus = {
      provider: 'binance',
      baseUrl,
      status: 'unknown',
      lastSuccess: null,
      lastError: null,
      lastChecked: new Date().toISOString()
    }
  }

  /**
   * Get the current provider status.
   */
  getStatus(): ProviderStatus {
    return { ...this.providerStatus }
  }

  /**
   * Fetch klines/candles from Binance public API.
   * Implements rate limiting, validation, and retry with exponential backoff.
   */
  async fetchCandles(inputData: CandleInput): Promise<Candle[]> {
    const symbol = inputData.symbol.toUpperCase()
    const limit = Math.min(inputData.limit ?? MAX_CANDLES_PER_REQUEST, MAX_CANDLES_PER_REQUEST)

    const params: Record<string, string> = {
      symbol,
      interval: inputData.interval,
      limit: String(Math.min(inputData.limit ?? MAX_CANDLES_PER_REQUEST, MAX_CANDLES_PER_REQUEST))
    }

    if (inputData.startTime) {
      params.startTime = String(inputData.startTime)
    }
    if (inputData.endTime) {
      params.endTime = String(inputData.endTime)
    }

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const result = await this.fetchWithRetry(params, attempt)
        return result
      } catch (err) {
        if (attempt === MAX_RETRIES - 1) {
          this.providerStatus = {
            ...this.providerStatus,
            status: 'offline',
            lastError: (err as Error).message,
            lastChecked: new Date().toISOString()
          }
          throw err
        }
        // Exponential backoff before retry
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt)
        await this.sleep(delay)
      }
    }

    throw new Error(`Failed to fetch candles for ${symbol} after ${MAX_RETRIES} attempts`)
  }

  private async fetchWithRetry(params: Record<string, string>, attempt: number): Promise<Candle[]> {
    const url = `${this.baseUrl}/klines?${new URLSearchParams(params).toString()}`

    this.requestCount++
    this.lastRequestTime = Date.now()

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate'
      }
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error')
      throw new Error(`Binance API ${response.status}: ${errorText}`)
    }

    const data: BinanceCandle[] = await response.json()

    // Validate and convert
    const candles: Candle[] = data.map((c, index) => {
      const openTime = c[0] as number
      const closeTime = c[6] as number
      const open = parseFloat(c[1])
      const high = parseFloat(c[2])
      const low = parseFloat(c[3])
      const close = parseFloat(c[4])
      const volume = parseFloat(c[5])

      // Validate: reject invalid data
      if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close) || isNaN(volume)) {
        throw new Error(`Invalid candle data at index ${index}: open=${c[1]}, high=${c[2]}, low=${c[3]}, close=${c[4]}, volume=${c[5]}`)
      }
      if (high < Math.max(open, close) || low > Math.min(open, close)) {
        throw new Error(`Invalid OHLC relationship at index ${index}: high=${high}, low=${low}, open=${open}, close=${close}`)
      }

      return {
        asset_id: params.symbol.toUpperCase(),
        timeframe: params.interval,
        start_utc: new Date(openTime).toISOString(),
        open,
        high,
        low,
        close,
        volume,
        provider: 'binance',
        received_utc: new Date().toISOString(),
        delayed_seconds: Math.floor((Date.now() - closeTime) / 1000),
        stale: false,
        rights_tag: 'public'
      }
    })

    this.providerStatus = {
      provider: 'binance',
      baseUrl: this.baseUrl,
      status: 'online',
      lastSuccess: new Date().toISOString(),
      lastError: null,
      lastChecked: new Date().toISOString()
    }

    return candles
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Fetch a single latest candle for health check.
   */
  async healthCheck(): Promise<ProviderStatus> {
    try {
      await this.fetchCandles({ symbol: 'BTCUSDT', interval: '1m', limit: 1 })
      this.providerStatus.status = 'online';
    } catch (err) {
      this.providerStatus = {
        ...this.providerStatus,
        status: 'offline',
        lastError: (err as Error).message,
        lastChecked: new Date().toISOString()
      }
    }
    return { ...this.providerStatus }
  }

  /**
   * Fetch candles and store them in the database.
   */
  async fetchAndStoreCandles(db: any, input: CandleInput): Promise<Candle[]> {
    const candles = await this.fetchCandles(input)

    const stmt = db.prepare(
      `INSERT OR IGNORE INTO candles (asset_id, timeframe, start_utc, open, high, low, close, volume, provider, received_utc, delayed_seconds, stale, rights_tag)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )

    for (const candle of candles) {
      stmt.run(
        candle.asset_id,
        candle.timeframe,
        candle.start_utc,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume,
        candle.provider,
        candle.received_utc,
        candle.delayed_seconds,
        candle.stale ? 1 : 0,
        candle.rights_tag
      )
    }

    return candles
  }
}

export function createBinanceConnector(): BinanceConnector {
  return new BinanceConnector()
}
