import test from "node:test";
import assert from "node:assert/strict";
import { searchFunds, summarizeMarket, topFunds } from "../dist/index.js";
import type { FundSnapshot } from "../dist/index.js";
import { matchesCode, withFetch } from "./helpers.js";

const snapshot = (fundCode: string, extra: Partial<FundSnapshot> = {}): FundSnapshot => ({
  fundCode, fundName: "İŞ PORTFÖY", kind: "YAT", date: "2026-10-20", price: 2,
  sharesOutstanding: 100, investorCount: 10, portfolioSize: 200, ...extra,
});

test("fund ranking excludes null values, retains zero and resolves ties by code", () => {
  const funds = [
    snapshot("CCC", { portfolioSize: null, investorCount: 50 }),
    snapshot("BBB", { portfolioSize: 200, investorCount: null }),
    snapshot("AAA", { portfolioSize: 200, investorCount: 20 }),
    snapshot("DDD", { portfolioSize: 0, investorCount: 0 }),
  ];
  assert.deepEqual(topFunds(funds, { by: "portfolioSize", limit: 10 }).map((fund) => fund.fundCode), ["AAA", "BBB", "DDD"]);
  assert.deepEqual(topFunds(funds, { by: "investorCount", limit: 2 }).map((fund) => fund.fundCode), ["CCC", "AAA"]);
  assert.deepEqual(topFunds(funds, { by: "portfolioSize", limit: 1 }).map((fund) => fund.fundCode), ["AAA"]);
  assert.deepEqual(topFunds([], { by: "portfolioSize", limit: 1 }), []);
  assert.deepEqual(topFunds([snapshot("AAA", { portfolioSize: null })], { by: "portfolioSize", limit: 1 }), []);
});

test("market summaries skip null figures and describe empty input without inventing metadata", () => {
  assert.deepEqual(summarizeMarket([
    snapshot("AAA"), snapshot("BBB", { portfolioSize: null, investorCount: null }),
    snapshot("CCC", { portfolioSize: 0, investorCount: 0 }),
    snapshot("DDD", { portfolioSize: 50.25, investorCount: 5 }),
  ]), { kind: "YAT", date: "2026-10-20", fundCount: 4, totalPortfolioSize: 250.25, totalInvestorCount: 15 });
  assert.deepEqual(summarizeMarket([]), {
    kind: null, date: null, fundCount: 0, totalPortfolioSize: 0, totalInvestorCount: 0,
  });
});

test("mixed kinds and dates independently clear summary metadata", () => {
  const sameDay = summarizeMarket([snapshot("AAA"), snapshot("BBB", { kind: "EMK" }), snapshot("CCC")]);
  assert.equal(sameDay.kind, null);
  assert.equal(sameDay.date, "2026-10-20");
  const sameKind = summarizeMarket([snapshot("AAA"), snapshot("BBB", { date: "2026-10-19" }), snapshot("CCC")]);
  assert.equal(sameKind.kind, "YAT");
  assert.equal(sameKind.date, null);
  const mixed = summarizeMarket([snapshot("AAA"), snapshot("BBB", { date: "2026-10-19", kind: "EMK" })]);
  assert.equal(mixed.kind, null);
  assert.equal(mixed.date, null);
});

test("market helpers make no requests and leave frozen snapshots unchanged", async () => {
  const first = Object.freeze(snapshot("BBB"));
  const second = Object.freeze(snapshot("AAA"));
  const funds = Object.freeze([first, second]);
  await withFetch(async () => { assert.fail("Market helpers must not send requests"); }, async () => {
    const ranked = topFunds(funds, { by: "portfolioSize", limit: 1 });
    assert.equal(ranked[0], second);
    assert.notEqual(ranked, funds);
    assert.equal(summarizeMarket(funds).fundCount, 2);
    const found = searchFunds(funds, "is");
    assert.equal(found[0]?.price, 2);
    assert.equal(found[0]?.date, "2026-10-20");
    assert.deepEqual(funds, [first, second]);
  });
});

test("invalid ranking options are rejected without coercion", () => {
  for (const options of [null, undefined, [], {}, { by: "price", limit: 1 }, { by: "portfolioSize", limit: 1, typo: true },
    ...[0, -1, 1.5, NaN, Infinity, "1", null].map((limit) => ({ by: "portfolioSize", limit }))]) {
    assert.throws(
      () => topFunds([], options as { readonly by: "portfolioSize" | "investorCount"; readonly limit: number }),
      matchesCode("INVALID_ARGUMENT"),
    );
  }
});

test("malformed market input and overflowing totals are rejected", () => {
  for (const input of [null, {}, [null], [{}],
    ...[
      { fundCode: "ti2" }, { fundName: " " }, { kind: "F" }, { date: "2026-02-30" }, { price: null },
      { price: -1 }, { investorCount: "10" }, { portfolioSize: Infinity }, { sharesOutstanding: undefined },
    ].map((extra) => [{ ...snapshot("TI2"), ...extra }]),
  ]) {
    const funds = input as readonly FundSnapshot[];
    assert.throws(() => summarizeMarket(funds), matchesCode("INVALID_ARGUMENT"));
    assert.throws(() => topFunds(funds, { by: "portfolioSize", limit: 1 }), matchesCode("INVALID_ARGUMENT"));
  }
  for (const field of ["portfolioSize", "investorCount"] as const) {
    assert.throws(
      () => summarizeMarket([snapshot("AAA", { [field]: Number.MAX_VALUE }), snapshot("BBB", { [field]: Number.MAX_VALUE })]),
      matchesCode("INVALID_ARGUMENT"),
    );
  }
});
