import type { FundType } from "./types.js";
import { invalidResponse, isRecord, validateEnvelope } from "./validation.js";

export function parseFundType(payload: unknown): FundType | null {
  if (isRecord(payload) && payload.errorCode === null && payload.errorMessage === "Index 0 out of bounds for length 0" && payload.fonTipi === null) {
    return null;
  }
  const response = validateEnvelope(payload);
  const type = response.fonTipi;
  if (type === null || type === "") return null;
  if (type === "F") return "investment";
  if (type === "M") return "pension";
  return invalidResponse("Missing or unsupported fund type.");
}
