import { TefasError } from "./errors.js";
import { isFundCode, isNonEmptyString, isRecord } from "./validation.js";

function normalizeSearchText(value: string): string {
  return value.toLocaleUpperCase("tr-TR").normalize("NFD").replace(/\p{M}/gu, "");
}

export function searchFunds<T extends { readonly fundCode: string; readonly fundName: string }>(
  funds: readonly T[],
  query: string,
): readonly T[] {
  const entries: readonly T[] = funds;
  if (!Array.isArray(funds) || !isNonEmptyString(query)) {
    throw new TefasError("INVALID_ARGUMENT", "Provide a fund array and a non-empty search query.");
  }
  const normalized = normalizeSearchText(query.trim());
  if (normalized === "") throw new TefasError("INVALID_ARGUMENT", "The search query has no searchable characters.");
  const matches: { readonly fund: T; readonly rank: number }[] = [];
  for (const fund of entries) {
    if (!isRecord(fund) || !isFundCode(fund.fundCode) || !isNonEmptyString(fund.fundName)) {
      throw new TefasError("INVALID_ARGUMENT", "Invalid fund search entry.");
    }
    const code = normalizeSearchText(fund.fundCode);
    const name = normalizeSearchText(fund.fundName);
    const rank = code === normalized ? 0 : code.startsWith(normalized) ? 1 : name.includes(normalized) ? 2 : -1;
    if (rank !== -1) matches.push({ fund, rank });
  }
  return matches
    .sort((left, right) => left.rank - right.rank || left.fund.fundCode.localeCompare(right.fund.fundCode))
    .map(({ fund }) => fund);
}
