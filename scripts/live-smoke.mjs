import assert from 'node:assert/strict';
import { TefasClient, TefasError } from '../dist/index.js';

const fundCode = process.argv[2] ?? 'TI2';
const client = new TefasClient({ timeoutMs: 15_000, maxRetries: 0 });

try {
  const history = await client.getPriceHistory(fundCode, { periodMonths: 1 });
  assert.equal(history.fundCode, fundCode.trim().toUpperCase());
  assert.ok(history.prices.length > 0, 'TEFAS returned no prices for the last month.');
  for (const { date, price } of history.prices) {
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number.isFinite(price));
  }
  console.log(`${history.fundCode} - ${history.fundName}`);
  console.log(`${history.prices.length} prices, ${history.returnedDateRange?.from} to ${history.returnedDateRange?.to}`);
  console.log('Last:', history.prices.at(-1));
  console.log('Live smoke OK');
} catch (error) {
  if (error instanceof TefasError) {
    console.error(`Live smoke failed: ${error.code}`, error.status ?? '', error.message);
  }
  throw error;
}
