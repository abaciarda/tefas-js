import { TefasError } from './errors.js';
import { parsePriceHistory } from './parser.js';
import { requestPriceHistory } from './transport.js';
import type {
  GetPriceHistoryOptions,
  HistoryPeriodMonths,
  PriceHistory,
} from './types.js';

type InitialHistoryOptions = Pick<GetPriceHistoryOptions, 'periodMonths'>;

const SUPPORTED_PERIODS: readonly number[] = [1, 3, 6, 12, 36, 60];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeFundCode(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TefasError('INVALID_ARGUMENT', 'Fund code must be a string.');
  }

  const normalized = value.trim().toUpperCase();

  if (!/^[A-Z0-9]{3}$/.test(normalized)) {
    throw new TefasError(
      'INVALID_ARGUMENT',
      'Fund code must contain exactly three ASCII letters or digits.',
    );
  }

  return normalized;
}

function isSupportedPeriod(value: unknown): value is HistoryPeriodMonths {
  return typeof value === 'number' && SUPPORTED_PERIODS.includes(value);
}

export class TefasClient {
  async getPriceHistory(
    fundCode: string,
    options: InitialHistoryOptions,
  ): Promise<PriceHistory> {
    const normalizedCode = normalizeFundCode(fundCode);

    if (
      !isRecord(options) ||
      Object.keys(options).some((key) => key !== 'periodMonths')
    ) {
      throw new TefasError(
        'INVALID_ARGUMENT',
        'Options must be an object containing only periodMonths.',
      );
    }

    const periodMonths = options.periodMonths;

    if (!isSupportedPeriod(periodMonths)) {
      throw new TefasError('INVALID_ARGUMENT', 'Unsupported history period.');
    }

    const payload = await requestPriceHistory(normalizedCode, periodMonths);
    return parsePriceHistory(payload, normalizedCode, periodMonths);
  }
}
