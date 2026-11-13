import { test, expect } from '@playwright/test';

const BASE_URL = 'https://bamaboy101.github.io/marketmesh-ai/';
const API_BASE = 'https://marketmesh-api.marketmesh-api.workers.dev';

test('MarketMesh loads and displays assets', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  
  // Check page title
  await expect(page).toHaveTitle(/MarketMesh/);
  
  // Check API is reachable
  const apiResponse = await page.request.get(`${API_BASE}/api/health`);
  expect(apiResponse.ok()).toBeTruthy();
  const health = await apiResponse.json();
  expect(health.status).toBe('ok');
  
  // Check assets endpoint
  const assetsResponse = await page.request.get(`${API_BASE}/api/assets`);
  expect(assetsResponse.ok()).toBeTruthy();
  const assets = await assetsResponse.json();
  expect(assets.length).toBeGreaterThan(0);
  
  // Take screenshot
  await page.screenshot({ path: 'marketmesh-assets.png', fullPage: true });
});

test('MarketMesh evaluates signal', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  
  // Verify API call
  const signalResponse = await page.request.post(`${API_BASE}/api/signals/evaluate`, {
    data: { asset_id: 'BTCUSDT', rule_id: 'rsi14', limit: 30 }
  });
  expect(signalResponse.ok()).toBeTruthy();
  const signal = await signalResponse.json();
  expect(signal.rule_id).toBe('rsi14');
  expect(typeof signal.fired).toBe('boolean');
  
  await page.screenshot({ path: 'marketmesh-signal.png', fullPage: true });
});

test('MarketMesh replay run', async ({ page }) => {
  const replayResponse = await page.request.post(`${API_BASE}/api/replay-run`, {
    data: { asset_id: 'BTCUSDT', rule_id: 'rsi14', limit: 30 }
  });
  expect(replayResponse.ok()).toBeTruthy();
  const replay = await replayResponse.json();
  expect(replay.rule_id).toBe('rsi14');
  expect(replay.asset_id).toBe('BTCUSDT');
  
  await page.screenshot({ path: 'marketmesh-replay.png', fullPage: true });
});
