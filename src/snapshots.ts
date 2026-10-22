import { TefasError } from "./errors.js";
import type { FundKind, FundSnapshot } from "./types.js";
import {
  invalidResponse, isDateString, isFundCode, isFundKind, isNonEmptyString, isNonNegativeNumber, isRecord, validateEnvelope,
} from "./validation.js";

export function validateSnapshotOptions(options: unknown): {
  readonly date: string;
  readonly kind: FundKind;
  readonly signal: AbortSignal | undefined;
} {
  if (!isRecord(options) || Object.keys(options).some((key) => key !== "date" && key !== "kind" && key !== "signal")) {
    throw new TefasError("INVALID_ARGUMENT", "Invalid snapshot options.");
  }
  if (!isDateString(options.date)) throw new TefasError("INVALID_ARGUMENT", "Invalid snapshot date.");
  const kind = options.kind === undefined ? "YAT" : options.kind;
  if (!isFundKind(kind)) throw new TefasError("INVALID_ARGUMENT", "Invalid fund kind.");
  const signal = options.signal;
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TefasError("INVALID_ARGUMENT", "Invalid cancellation signal.");
  }
  return { date: options.date, kind, signal };
}

export function dailyRequestBody(
  fundCode: string | null,
  kind: FundKind,
  from: string,
  to: string = from,
): Readonly<Record<string, unknown>> {
  return {
    fonTipi: kind,
    fonKodu: fundCode,
    aramaMetni: null,
    fonTurKod: null,
    fonGrubu: null,
    sfonTurKod: null,
    fonTurAciklama: null,
    kurucuKod: null,
    basTarih: from.replaceAll("-", ""),
    bitTarih: to.replaceAll("-", ""),
    basSira: 1,
    bitSira: 100000,
    dil: "TR",
    sFonTurKod: "",
    fonKod: "",
    fonGrup: "",
    fonUnvanTip: "",
  };
}

function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!isNonNegativeNumber(value)) invalidResponse("Invalid numeric snapshot field.");
  return value;
}

export function sameSnapshot(left: FundSnapshot, right: FundSnapshot): boolean {
  return left.fundCode === right.fundCode && left.fundName === right.fundName && left.kind === right.kind &&
    left.date === right.date && left.price === right.price && left.sharesOutstanding === right.sharesOutstanding &&
    left.investorCount === right.investorCount && left.portfolioSize === right.portfolioSize;
}

export function isEmptyDailyResponse(payload: unknown): boolean {
  return isRecord(payload) && payload.errorCode === null && payload.errorMessage === "Index 0 out of bounds for length 0" &&
    payload.resultList === null;
}

export function readSnapshotRows(payload: unknown): unknown[] {
  const response = validateEnvelope(payload);
  if (!Array.isArray(response.resultList)) invalidResponse("Missing or invalid snapshot resultList.");
  return response.resultList;
}

export function readSnapshotRow(
  row: unknown,
  kind: FundKind,
  fundCode: string | undefined,
  isExpectedDate: (date: string) => boolean,
): FundSnapshot {
  if (!isRecord(row) || !isFundCode(row.fonKodu) || !isNonEmptyString(row.fonUnvan)) {
    invalidResponse("Invalid snapshot fund information.");
  }
  if (fundCode !== undefined && row.fonKodu !== fundCode) invalidResponse("The snapshot contains a different fund code.");
  if (!isDateString(row.tarih) || !isExpectedDate(row.tarih)) invalidResponse("The snapshot contains an invalid or unexpected date.");
  if (!isNonNegativeNumber(row.fiyat)) invalidResponse("Invalid snapshot price.");
  return {
    fundCode: row.fonKodu,
    fundName: row.fonUnvan.trim(),
    kind,
    date: row.tarih,
    price: row.fiyat,
    sharesOutstanding: optionalNumber(row.tedPaySayisi),
    investorCount: optionalNumber(row.kisiSayisi),
    portfolioSize: optionalNumber(row.portfoyBuyukluk),
  };
}

export function parseSnapshots(
  payload: unknown,
  kind: FundKind,
  date: string,
  fundCode?: string,
): readonly FundSnapshot[] {
  if (isEmptyDailyResponse(payload)) return [];
  const byCode = new Map<string, FundSnapshot>();
  for (const row of readSnapshotRows(payload)) {
    const snapshot = readSnapshotRow(row, kind, fundCode, (rowDate) => rowDate === date);
    const previous = byCode.get(snapshot.fundCode);
    if (previous !== undefined && !sameSnapshot(previous, snapshot)) {
      invalidResponse("The response contains conflicting snapshots for one fund.");
    }
    byCode.set(snapshot.fundCode, snapshot);
  }
  return [...byCode.values()].sort((left, right) => left.fundCode.localeCompare(right.fundCode));
}
