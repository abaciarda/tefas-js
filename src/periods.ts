import { TefasError } from "./errors.js";
import type { HistoryPeriod, HistoryPeriodMonths } from "./types.js";

const SOURCE_PERIODS = {
  "1w": 13,
  "1m": 1,
  "3m": 3,
  "6m": 6,
  ytd: 0,
  "1y": 12,
  "3y": 36,
  "5y": 60,
} as const satisfies Readonly<Record<HistoryPeriod, number>>;

export function isHistoryPeriod(value: unknown): value is HistoryPeriod {
  return typeof value === "string" && Object.hasOwn(SOURCE_PERIODS, value);
}

export function toSourcePeriod(period: HistoryPeriod): HistoryPeriodMonths | 0 | 13 {
  return SOURCE_PERIODS[period];
}

export function toPeriodMonths(period: HistoryPeriod): HistoryPeriodMonths | null {
  const source = toSourcePeriod(period);
  return source === 0 || source === 13 ? null : source;
}

export function resolveHistoryPeriod(options: Readonly<Record<string, unknown>>): HistoryPeriod {
  const hasMonths = "periodMonths" in options;
  const hasPeriod = "period" in options;
  if (hasMonths === hasPeriod) {
    throw new TefasError("INVALID_ARGUMENT", "Provide exactly one of periodMonths or period.");
  }
  if (hasPeriod && isHistoryPeriod(options.period)) return options.period;
  if (hasMonths && typeof options.periodMonths === "number") {
    for (const period of Object.keys(SOURCE_PERIODS)) {
      if (isHistoryPeriod(period) && toPeriodMonths(period) === options.periodMonths) return period;
    }
  }
  throw new TefasError("INVALID_ARGUMENT", "Unsupported history period.");
}
