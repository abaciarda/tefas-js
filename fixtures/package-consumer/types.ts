import { TefasClient, TefasError } from 'tefas-js';
import type {
  GetPriceHistoryOptions,
  HistoryPeriod,
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
const namedPeriod: HistoryPeriod = 'ytd';
const namedOptions: GetPriceHistoryOptions = { period: namedPeriod };
const namedResult: Promise<PriceHistory> = client.getPriceHistory('TI2', namedOptions);
const code: TefasErrorCode = 'TIMEOUT';
const error: Error = new TefasError(code, 'Example failure', { cause: new Error('Root cause') });
void result;
void namedResult;
void error;

// @ts-expect-error Unsupported periods must be rejected.
client.getPriceHistory('TI2', { periodMonths: 2 });
// @ts-expect-error The period is required.
client.getPriceHistory('TI2', {});
// @ts-expect-error Named periods must be supported.
client.getPriceHistory('TI2', { period: '12m' });
// @ts-expect-error Both period formats cannot be supplied together.
client.getPriceHistory('TI2', { period: '1y', periodMonths: 12 });
// @ts-expect-error An explicitly undefined second period is still invalid.
client.getPriceHistory('TI2', { period: '1w', periodMonths: undefined });
// @ts-expect-error Timeout must be numeric.
new TefasClient({ timeoutMs: '1000' });
// @ts-expect-error Cancellation requires an AbortSignal.
client.getPriceHistory('TI2', { periodMonths: 1, signal: {} });

function checkReadonly(history: PriceHistory) {
  const months: HistoryPeriodMonths | null = history.periodMonths;
  const periodName: HistoryPeriod = history.period;
  void months;
  void periodName;
  // @ts-expect-error Weekly and YTD periods do not have a month count.
  const requiredMonths: HistoryPeriodMonths = history.periodMonths;
  void requiredMonths;
  // @ts-expect-error Public price arrays are readonly.
  history.prices.push({ date: '2026-10-20', price: 2 });
}
void checkReadonly;
