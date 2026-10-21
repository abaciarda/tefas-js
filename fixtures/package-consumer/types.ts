import { TefasClient, TefasError } from 'tefas-js';
import type {
  GetPriceHistoryOptions,
  HistoryPeriodMonths,
  PriceHistory,
  TefasClientOptions,
  TefasErrorCode,
} from 'tefas-js';

const clientOptions: TefasClientOptions = { timeoutMs: 1000, maxRetries: 1 };
const client = new TefasClient(clientOptions);
const period: HistoryPeriodMonths = 12;
const options: GetPriceHistoryOptions = {
  periodMonths: period,
  signal: new AbortController().signal,
};
const result: Promise<PriceHistory> = client.getPriceHistory('TI2', options);
const code: TefasErrorCode = 'TIMEOUT';
const error: Error = new TefasError(code, 'Example failure', { cause: new Error('Root cause') });
void result;
void error;

// @ts-expect-error Unsupported periods must be rejected.
client.getPriceHistory('TI2', { periodMonths: 2 });
// @ts-expect-error The period is required.
client.getPriceHistory('TI2', {});
// @ts-expect-error Timeout must be numeric.
new TefasClient({ timeoutMs: '1000' });
// @ts-expect-error Cancellation requires an AbortSignal.
client.getPriceHistory('TI2', { periodMonths: 1, signal: {} });

function checkReadonly(history: PriceHistory) {
  // @ts-expect-error Public price arrays are readonly.
  history.prices.push({ date: '2026-10-20', price: 2 });
}
void checkReadonly;
