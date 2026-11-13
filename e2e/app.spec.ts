import { test, expect } from '@playwright/test'
import { instrument, openApp, shoot, dumpDiagnostics, expectWorkerCall, WORKER, APP } from './helpers'

test.describe(`${APP} — live public acceptance`, () => {
  test('renders, loads watchlist from the Worker, evaluates a signal, persists across reload', async ({ page, browser }, testInfo) => {
    const probe = instrument(page)
    const project = testInfo.project.name

    await openApp(page)
    await expect(page).toHaveTitle(/MarketMesh/i)
    await expect(page.getByRole('heading', { name: 'Watchlist' })).toBeVisible()

    // Asset list must come from the deployed Worker, including SOLUSDT.
    await expect(page.getByText('Solana / Tether')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByText('Bitcoin / Tether')).toBeVisible()
    await expectWorkerCall(probe.workerCalls, '/api/assets')
    await shoot(page, '01-watchlist', project)

    // Select BTCUSDT and load real candles.
    await page.getByText('Bitcoin / Tether').click()
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(page.locator('svg path').first()).toBeVisible({ timeout: 45_000 })
    await expectWorkerCall(probe.workerCalls, '/api/candles')
    await shoot(page, '02-candles', project)

    // Evaluate a signal through the real API.
    await page.getByRole('button', { name: 'Evaluate Signal' }).click()
    await expect(page.getByText(/RSI-14 =/)).toBeVisible({ timeout: 45_000 })
    await expectWorkerCall(probe.workerCalls, '/api/signals/evaluate', 'POST')
    await shoot(page, '03-signal', project)

    // Persistence: the signal is stored server-side and survives a reload.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator('nav')).toBeVisible()
    const stored = await page.request.get(`${WORKER}/api/signals`, {
      headers: { 'x-demo-session': await page.evaluate(() => localStorage.getItem('demo-session-id')) || '' },
    })
    expect(stored.status()).toBe(200)
    const rows = await stored.json()
    expect(Array.isArray(rows)).toBeTruthy()
    expect(rows.length).toBeGreaterThan(0)
    await shoot(page, '04-after-reload', project)

    // No trading affordances anywhere in the product.
    await expect(page.getByRole('button', { name: /buy|sell|trade|order/i })).toHaveCount(0)

    // A second, isolated visitor must not see this visitor's signal history.
    const otherCtx = await browser.newContext()
    const other = await otherCtx.newPage()
    await openApp(other)
    const otherSession = await other.evaluate(() => localStorage.getItem('demo-session-id'))
    const mineSession = await page.evaluate(() => localStorage.getItem('demo-session-id'))
    expect(otherSession).not.toEqual(mineSession)
    const otherRows = await (await other.request.get(`${WORKER}/api/signals`, {
      headers: { 'x-demo-session': otherSession || '' },
    })).json()
    expect(otherRows.length).toBe(0)
    await shoot(other, '05-isolated-visitor', project)
    await otherCtx.close()

    dumpDiagnostics(`${project}-network`, probe)
    expect(probe.failedRequests, `failed app requests: ${probe.failedRequests.join(' | ')}`).toEqual([])
    expect(probe.consoleErrors, `console errors: ${probe.consoleErrors.join(' | ')}`).toEqual([])
  })
})
