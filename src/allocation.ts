import type { AllocationKey, FundAllocation, FundKind } from "./types.js";
import { invalidResponse, isDateString, isFundCode, isNonEmptyString, isPercentage, isRecord, validateEnvelope } from "./validation.js";

const ALLOCATION_FIELDS = {
  hs: "stock",
  dt: "governmentBond",
  hb: "treasuryBill",
  fb: "financingBill",
  ost: "privateSectorBond",
  bb: "bankBill",
  vdm: "assetBackedSecurities",
  eut: "eurobond",
  kibd: "governmentExternalDebt",
  osdb: "privateSectorExternalDebt",
  kba: "fxGovernmentInternalDebt",
  dot: "fxPayableBill",
  db: "fxPayableBond",
  tpp: "takasbankMoneyMarket",
  bpp: "bistMoneyMarket",
  btaa: "bistCommittedBuy",
  btas: "bistCommittedSell",
  r: "repo",
  tr: "reverseRepo",
  vm: "termDeposit",
  vmtl: "depositTl",
  vmd: "depositFx",
  vmau: "depositGold",
  kh: "participationAccount",
  khtl: "participationAccountTl",
  khd: "participationAccountFx",
  khau: "participationAccountGold",
  kks: "governmentLeaseCertificate",
  kkstl: "governmentLeaseCertificateTl",
  kksd: "governmentLeaseCertificateFx",
  kksyd: "governmentForeignLeaseCertificate",
  osks: "privateSectorLeaseCertificate",
  oksyd: "privateSectorForeignLeaseCertificate",
  km: "preciousMetals",
  kmbyf: "preciousMetalsEtf",
  kmkba: "preciousMetalsGovernmentDebt",
  kmkks: "preciousMetalsLeaseCertificate",
  ymk: "foreignSecurity",
  yba: "foreignDebtSecurity",
  ybkb: "foreignGovernmentDebt",
  ybosb: "foreignPrivateSectorDebt",
  yhs: "foreignStock",
  ybyf: "foreignEtf",
  fkb: "fundParticipationCertificate",
  yyf: "investmentFund",
  byf: "etf",
  gykb: "realEstateFund",
  gyy: "realEstateInvestment",
  gsykb: "ventureCapitalFund",
  gsyy: "ventureCapitalInvestment",
  t: "derivative",
  vint: "futuresCashCollateral",
  gas: "realEstateCertificate",
  d: "other",
} as const satisfies Readonly<Record<string, AllocationKey>>;

export function parseAllocation(payload: unknown, fundCode: string, kind: FundKind, date: string): FundAllocation | null {
  if (isRecord(payload) && payload.errorCode === null && payload.errorMessage === "Index 0 out of bounds for length 0" && payload.resultList === null) {
    return null;
  }
  const response = validateEnvelope(payload);
  if (!Array.isArray(response.resultList)) invalidResponse("Missing or invalid allocation resultList.");
  const rows: unknown[] = response.resultList;
  let allocation: FundAllocation | null = null;
  for (const row of rows) {
    if (!isRecord(row) || !isFundCode(row.fonKodu) || row.fonKodu !== fundCode || !isNonEmptyString(row.fonUnvan)) {
      invalidResponse("Invalid or unexpected allocation fund information.");
    }
    if (!isDateString(row.tarih) || row.tarih !== date) invalidResponse("The allocation contains an invalid or unexpected date.");
    const weights: Partial<Record<AllocationKey, number>> = {};
    let total = 0;
    for (const [source, key] of Object.entries(ALLOCATION_FIELDS)) {
      const value = row[source];
      if (value === undefined || value === null) continue;
      if (!isPercentage(value)) invalidResponse("Invalid allocation percentage.");
      weights[key] = value;
      total += value;
    }
    if (Math.abs(total - 100) > 0.5 + 1e-10) invalidResponse("Allocation percentages do not add up to 100.");
    const current: FundAllocation = { fundCode: row.fonKodu, fundName: row.fonUnvan.trim(), kind, date: row.tarih, weights };
    if (allocation !== null && (allocation.fundName !== current.fundName ||
      Object.values(ALLOCATION_FIELDS).some((key) => allocation?.weights[key] !== current.weights[key]))) {
      invalidResponse("The response contains conflicting allocations for one fund.");
    }
    allocation = current;
  }
  return allocation;
}
