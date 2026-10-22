import { TefasError } from "./errors.js";
import { isEmptyDailyResponse, readSnapshotRow, readSnapshotRows, sameSnapshot } from "./snapshots.js";
import type { FundKind, FundSnapshot, GetDailyHistoryOptions } from "./types.js";
import { invalidResponse, isDateString, isFundKind, isRecord } from "./validation.js";

const DAY_MS = 86_400_000;
const MAX_DAYS = 1827;
const CHUNK_DAYS = 28;
const MAX_TIMER_MS = 2_147_483_647;
const OPTION_KEYS = new Set(["from", "to", "kind", "minIntervalMs", "timeoutMs", "onProgress", "signal"]);

export interface DateRange {
  readonly from: string;
  readonly to: string;
}

type ProgressCallback = NonNullable<GetDailyHistoryOptions["onProgress"]>;

function toUtcDay(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS;
}

function fromUtcDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function countDays(from: string, to: string): number {
  return toUtcDay(to) - toUtcDay(from) + 1;
}

export function planDailyChunks(from: string, to: string): readonly DateRange[] {
  const last = toUtcDay(to);
  const chunks: DateRange[] = [];
  for (let start = toUtcDay(from); start <= last; start += CHUNK_DAYS) {
    chunks.push({ from: fromUtcDay(start), to: fromUtcDay(Math.min(start + CHUNK_DAYS - 1, last)) });
  }
  return chunks;
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export function validateDailyHistoryOptions(options: unknown, requestTimeoutMs: number): {
  readonly chunks: readonly DateRange[];
  readonly kind: FundKind;
  readonly minIntervalMs: number;
  readonly timeoutMs: number;
  readonly onProgress: ProgressCallback | undefined;
  readonly signal: AbortSignal | undefined;
} {
  if (!isRecord(options) || Object.keys(options).some((key) => !OPTION_KEYS.has(key))) {
    throw new TefasError("INVALID_ARGUMENT", "Invalid daily history options.");
  }
  const { from, to } = options;
  if (!isDateString(from) || !isDateString(to)) throw new TefasError("INVALID_ARGUMENT", "Invalid daily history date.");
  const days = countDays(from, to);
  if (days < 1 || days > MAX_DAYS) {
    throw new TefasError("INVALID_ARGUMENT", `Daily history ranges must cover 1 to ${MAX_DAYS} days.`);
  }
  const kind = options.kind === undefined ? "YAT" : options.kind;
  if (!isFundKind(kind)) throw new TefasError("INVALID_ARGUMENT", "Invalid fund kind.");
  const minIntervalMs = options.minIntervalMs === undefined ? 10_000 : options.minIntervalMs;
  if (!isIntegerInRange(minIntervalMs, 0, 60_000)) {
    throw new TefasError("INVALID_ARGUMENT", "minIntervalMs must be an integer from 0 to 60000.");
  }
  const chunks = planDailyChunks(from, to);
  const timeoutMs = options.timeoutMs === undefined
    ? Math.min(MAX_TIMER_MS, chunks.length * (minIntervalMs + requestTimeoutMs))
    : options.timeoutMs;
  if (!isIntegerInRange(timeoutMs, 1, MAX_TIMER_MS)) throw new TefasError("INVALID_ARGUMENT", "Invalid daily history timeout.");
  const onProgress = options.onProgress;
  if (onProgress !== undefined && typeof onProgress !== "function") {
    throw new TefasError("INVALID_ARGUMENT", "Invalid progress callback.");
  }
  const signal = options.signal;
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TefasError("INVALID_ARGUMENT", "Invalid cancellation signal.");
  }
  return { chunks, kind, minIntervalMs, timeoutMs, onProgress: onProgress as ProgressCallback | undefined, signal };
}

export function parseDailyChunk(payload: unknown, fundCode: string, kind: FundKind, chunk: DateRange): readonly FundSnapshot[] {
  if (isEmptyDailyResponse(payload)) return [];
  return readSnapshotRows(payload).map((row) =>
    readSnapshotRow(row, kind, fundCode, (date) => date >= chunk.from && date <= chunk.to));
}

export function mergeDailySnapshots(byDate: Map<string, FundSnapshot>, snapshots: readonly FundSnapshot[]): void {
  for (const snapshot of snapshots) {
    const previous = byDate.get(snapshot.date);
    if (previous !== undefined && !sameSnapshot(previous, snapshot)) {
      invalidResponse("The response contains conflicting snapshots for one date.");
    }
    byDate.set(snapshot.date, snapshot);
  }
}
