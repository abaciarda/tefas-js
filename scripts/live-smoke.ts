import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { TefasClient, TefasError, searchFunds, topFunds, summarizeMarket } from '../dist/index.js';
import type { FundSnapshot } from '../dist/index.js';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
assert.ok(args.length <= 2, 'Usage: bun run smoke:live -- [fundCode] [YYYY-MM-DD]');
const fundCode = (args[0] ?? 'TI2').trim().toUpperCase();
assert.match(fundCode, /^[A-Z0-9]{3}$/);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const previous = new Date(`${today}T00:00:00Z`);
do { previous.setUTCDate(previous.getUTCDate() - 1); } while (previous.getUTCDay() === 0 || previous.getUTCDay() === 6);
const date = args[1] ?? previous.toISOString().slice(0, 10);
assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10), date);
const first = new Date(`${date}T00:00:00Z`);
first.setUTCDate(first.getUTCDate() - 39);
const from = first.toISOString().slice(0, 10);
const client = new TefasClient({ timeoutMs: 15_000, maxRetries: 0 });
const originalFetch = globalThis.fetch;
const completed: string[] = [];
let requests = 0;
let active = '';
globalThis.fetch = async (input, init) => {
  requests += 1;
  return originalFetch(input, init);
};

async function check(name: string, run: () => Promise<void>): Promise<void> {
  if (completed.length > 0) await delay(12_000);
  active = name;
  await run();
  completed.push(name);
  console.log(`${name} OK (${requests} requests so far)`);
}

function checkSnapshot(snapshot: FundSnapshot, expectedDate = date): void {
  assert.match(snapshot.fundCode, /^[A-Z0-9]{3}$/);
  assert.equal(snapshot.date, expectedDate);
  assert.ok(Number.isFinite(snapshot.price) && snapshot.price >= 0);
  for (const value of [snapshot.sharesOutstanding, snapshot.investorCount, snapshot.portfolioSize]) {
    assert.ok(value === null || (Number.isFinite(value) && value >= 0));
  }
}

console.log(`Live smoke: ${fundCode}, date ${date}, history ${from} to ${date}; retries disabled, 12s intervals.`);
try {
  await check('getPriceHistory', async () => {
    const history = await client.getPriceHistory(fundCode, { period: '1m' });
    assert.equal(history.fundCode, fundCode);
    assert.ok(history.prices.length > 0);
    for (const [index, price] of history.prices.entries()) {
      assert.match(price.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(Number.isFinite(price.price) && price.price >= 0);
      if (index > 0) assert.ok(history.prices[index - 1]!.date < price.date);
    }
  });
  await check('listFunds', async () => {
    const funds = await client.listFunds();
    assert.ok(funds.length > 0);
    assert.ok(searchFunds(funds, fundCode).some((fund) => fund.fundCode === fundCode));
  });
  await check('getSnapshot', async () => {
    const snapshot = await client.getSnapshot(fundCode, { date });
    assert.ok(snapshot, 'No snapshot: check the reference date and fund kind.');
    assert.equal(snapshot.fundCode, fundCode);
    checkSnapshot(snapshot);
  });
  await check('getSnapshots', async () => {
    const snapshots = await client.getSnapshots({ date });
    assert.ok(snapshots.length > 0);
    snapshots.forEach((snapshot) => checkSnapshot(snapshot));
    for (let index = 1; index < snapshots.length; index += 1) {
      assert.ok(snapshots[index - 1]!.fundCode < snapshots[index]!.fundCode);
    }
    assert.ok(snapshots.some((fund) => fund.fundCode === fundCode));
    assert.equal(summarizeMarket(snapshots).fundCount, snapshots.length);
    assert.ok(topFunds(snapshots, { by: 'portfolioSize', limit: 3 }).length > 0);
  });
  await check('getAllocation', async () => {
    const allocation = await client.getAllocation(fundCode, { date });
    assert.ok(allocation, 'No allocation: check the reference date.');
    assert.equal(allocation.fundCode, fundCode);
    assert.equal(allocation.date, date);
    const weights = Object.values(allocation.weights);
    assert.ok(weights.length > 0);
    assert.ok(weights.every((value) => Number.isFinite(value) && value >= 0 && value <= 100));
    assert.ok(Math.abs(weights.reduce((sum, value) => sum + value, 0) - 100) <= 0.5 + 1e-10);
    assert.equal('bilFiyat' in allocation.weights, false);
  });
  await check('getComparison', async () => {
    const comparison = await client.getComparison(fundCode, { period: '1y' });
    assert.equal(comparison.fundCode, fundCode);
    assert.ok(comparison.fundReturn !== null && Number.isFinite(comparison.fundReturn));
    assert.ok(Object.keys(comparison.benchmarks).length > 0);
    assert.ok(Object.values(comparison.benchmarks).every(Number.isFinite));
    console.log('Comparison returns are ratios:', comparison);
  });
  await check('getFundType', async () => {
    assert.equal(await client.getFundType(fundCode), 'investment', 'This smoke suite uses the YAT query category.');
  });
  await check('getDailyHistory', async () => {
    const progress: { completed: number; total: number }[] = [];
    const history = await client.getDailyHistory(fundCode, {
      from, to: date, minIntervalMs: 12_000, timeoutMs: 90_000,
      onProgress: (entry) => { progress.push({ ...entry }); console.log(`History ${entry.completed}/${entry.total}`); },
    });
    assert.ok(history.length > 0);
    assert.deepEqual(progress, [{ completed: 1, total: 2 }, { completed: 2, total: 2 }]);
    for (const [index, snapshot] of history.entries()) {
      assert.equal(snapshot.fundCode, fundCode);
      assert.ok(snapshot.date >= from && snapshot.date <= date);
      checkSnapshot(snapshot, snapshot.date);
      if (index > 0) assert.ok(history[index - 1]!.date < snapshot.date);
    }
    console.log(`${history.length} daily snapshots`);
  });
  assert.equal(requests, 9);
  console.log(`Live smoke OK: ${completed.length} methods, ${requests} requests.`);
} catch (error) {
  console.error(`Live smoke stopped at ${active}; completed: ${completed.join(', ') || 'none'}; requests: ${requests}.`);
  if (error instanceof TefasError) console.error(error.code, error.status ?? '', error.message);
  throw error;
} finally {
  globalThis.fetch = originalFetch;
}
