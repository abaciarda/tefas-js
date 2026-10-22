import type { BenchmarkKey, FundComparison, HistoryPeriod } from "./types.js";
import { invalidResponse, isFundCode, isNonEmptyString, isRecord, validateEnvelope } from "./validation.js";

const BENCHMARK_ROWS: ReadonlyMap<string, { readonly key: BenchmarkKey; readonly type: string }> = new Map([
  ["ALTIN", { key: "gold", type: "ALTIN" }],
  ["BIST100", { key: "bist100", type: "BIST100" }],
  ["BIST30", { key: "bist30", type: "BIST30" }],
  ["EUR", { key: "eur", type: "EUR" }],
  ["USD", { key: "usd", type: "USD" }],
  ["MEVDUAT FAIZI", { key: "depositRate", type: "MF" }],
  ["TUFE", { key: "inflation", type: "TUFE" }],
]);

function readReturn(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalidResponse("Invalid comparison return.");
  return value;
}

export function parseComparison(payload: unknown, fundCode: string, period: HistoryPeriod): FundComparison {
  const response = validateEnvelope(payload);
  if (!Array.isArray(response.resultList)) invalidResponse("Missing or invalid comparison resultList.");
  const rows: unknown[] = response.resultList;
  let fundReturn: number | null = null;
  const benchmarks: Partial<Record<BenchmarkKey, number>> = {};
  const store = (key: BenchmarkKey, value: number) => {
    const previous = benchmarks[key];
    if (previous !== undefined && previous !== value) invalidResponse("The response contains conflicting comparison returns.");
    benchmarks[key] = value;
  };
  for (const row of rows) {
    if (!isRecord(row) || !isNonEmptyString(row.fonKodu) || !isNonEmptyString(row.fonTuru)) {
      invalidResponse("Invalid comparison row.");
    }
    const benchmark = BENCHMARK_ROWS.get(row.fonKodu);
    if (benchmark !== undefined && row.fonTuru === benchmark.type) {
      store(benchmark.key, readReturn(row.fonTurGetiri));
    } else if (row.fonKodu === fundCode) {
      const value = readReturn(row.fonTurGetiri);
      if (fundReturn !== null && fundReturn !== value) invalidResponse("The response contains conflicting fund returns.");
      fundReturn = value;
    } else if (benchmark !== undefined) {
      invalidResponse("Invalid comparison benchmark type.");
    } else if (isFundCode(row.fonKodu)) {
      invalidResponse("The comparison contains a different fund code.");
    } else if (/şemsiye fonu$/iu.test(row.fonTuru.trim())) {
      store("umbrellaCategory", readReturn(row.fonTurGetiri));
    }
  }
  return { fundCode, period, fundReturn, benchmarks };
}
