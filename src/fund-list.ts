import { TefasError } from "./errors.js";
import type { FundListing } from "./types.js";
import { invalidResponse, isFundCode, isNonEmptyString, isRecord, validateEnvelope } from "./validation.js";

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!isNonEmptyString(value)) invalidResponse("Invalid fund founder information.");
  return value.trim();
}

export function parseFundListings(payload: unknown): readonly FundListing[] {
  const response = validateEnvelope(payload);
  if (typeof response.error !== "boolean") invalidResponse("Missing or invalid fund list error flag.");
  if (response.error) throw new TefasError("SOURCE_ERROR", "The data source reported a failed fund listing.");
  if (!Array.isArray(response.data)) invalidResponse("Missing or invalid fund list data.");

  const rows: unknown[] = response.data;
  const byCode = new Map<string, FundListing>();
  for (const row of rows) {
    if (!isRecord(row) || !isFundCode(row.fonKod) || !isNonEmptyString(row.unvan)) {
      invalidResponse("Invalid fund listing row.");
    }
    const fund: FundListing = {
      fundCode: row.fonKod,
      fundName: row.unvan.trim(),
      founderCode: optionalText(row.kurucuKod),
      founderName: optionalText(row.kurucuAd),
    };
    const previous = byCode.get(fund.fundCode);
    if (previous !== undefined && (
      previous.fundName !== fund.fundName || previous.founderCode !== fund.founderCode || previous.founderName !== fund.founderName
    )) {
      invalidResponse("The fund list contains conflicting entries for one code.");
    }
    byCode.set(fund.fundCode, fund);
  }
  return [...byCode.values()].sort((left, right) => left.fundCode.localeCompare(right.fundCode));
}
