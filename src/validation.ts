import { TefasError } from "./errors.js";
import type { FundKind } from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDateString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function isFundCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9]{3}$/.test(value);
}

export function normalizeFundCode(value: unknown): string {
  if (typeof value !== "string") {
    throw new TefasError("INVALID_ARGUMENT", "Fund code must be a string.");
  }
  const normalized = value.trim().toUpperCase();
  if (!isFundCode(normalized)) {
    throw new TefasError("INVALID_ARGUMENT", "Fund code must contain exactly three ASCII letters or digits.");
  }
  return normalized;
}

export function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function isPercentage(value: unknown): value is number {
  return isNonNegativeNumber(value) && value <= 100;
}

export function isFundKind(value: unknown): value is FundKind {
  return value === "YAT" || value === "EMK" || value === "BYF" || value === "GYF" || value === "GSYF";
}

export function invalidResponse(message: string): never {
  throw new TefasError("INVALID_RESPONSE", message);
}

export function validateEnvelope(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) invalidResponse("Expected a response object");

  const sourceCode = payload.errorCode;
  const sourceMessage = payload.errorMessage;
  if (sourceCode !== null && typeof sourceCode !== "string" && typeof sourceCode !== "number") {
    invalidResponse("Missing or invalid source error code.");
  }
  if (
    (typeof sourceCode === "number" && !Number.isFinite(sourceCode)) ||
    (typeof sourceCode === "string" && sourceCode.trim() === "")
  ) {
    invalidResponse("Invalid source error code.");
  }
  if (sourceMessage !== null && typeof sourceMessage !== "string") {
    invalidResponse("Missing or invalid source error message.");
  }
  if (
    (sourceCode !== null && sourceCode !== 0 && sourceCode !== "0") ||
    (typeof sourceMessage === "string" && sourceMessage.trim() !== "")
  ) {
    throw new TefasError(
      "SOURCE_ERROR",
      "The data source reported a failed operation.",
      sourceCode === null ? {} : { sourceCode },
    );
  }
  return payload;
}
