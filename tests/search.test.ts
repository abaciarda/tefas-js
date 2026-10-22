import test from "node:test";
import assert from "node:assert/strict";
import { searchFunds } from "../dist/index.js";
import { matchesCode, withFetch } from "./helpers.js";

test("fund search ranks exact codes, code prefixes and name matches with code ordering", () => {
  const funds = [
    { fundCode: "ZAA", fundName: "Tİ VE TI2 FONU" },
    { fundCode: "TIA", fundName: "OTHER FUND" },
    { fundCode: "TI2", fundName: "İŞ PORTFÖY" },
    { fundCode: "AAA", fundName: "Tİ VE TI2 FONU" },
  ];
  assert.deepEqual(searchFunds(funds, " ti ").map((fund) => fund.fundCode), ["TI2", "TIA", "AAA", "ZAA"]);
  assert.deepEqual(searchFunds(funds, " ti2 ").map((fund) => fund.fundCode), ["TI2", "AAA", "ZAA"]);
});

test("Turkish fund search handles dotted I and searches without Turkish letter marks", () => {
  const funds = [
    { fundCode: "TI2", fundName: "İŞ PORTFÖY HİSSE SENEDİ FONU" },
    { fundCode: "GAA", fundName: "GARANTİ PORTFÖY" },
    { fundCode: "UAA", fundName: "ÜÇÜNCÜ DEĞİŞKEN FON" },
  ];
  for (const query of ["is", "iş", "İŞ", "ıs"]) assert.equal(searchFunds(funds, query)[0], funds[0]);
  for (const query of ["garanti", "GARANTI", "GARANTİ"]) assert.equal(searchFunds(funds, query)[0], funds[1]);
  for (const query of ["ucuncu", "üçüncü", "degisken"]) assert.equal(searchFunds(funds, query)[0], funds[2]);
});

test("search is pure, preserves generic fields and accepts frozen inputs", async () => {
  const first = Object.freeze({ fundCode: "TI2", fundName: "İŞ PORTFÖY", kind: "YAT", date: "2026-10-20", price: 2 });
  const second = Object.freeze({ fundCode: "AAA", fundName: "OTHER FUND", kind: "YAT", date: "2026-10-20", price: 1 });
  const funds = Object.freeze([second, first]);
  await withFetch(async () => {
    assert.fail("Search must not send requests");
  }, async () => {
    const result = searchFunds(funds, "is");
    assert.notEqual(result, funds);
    assert.equal(result.length, 1);
    assert.equal(result[0], first);
    assert.equal(result[0]?.price, 2);
    assert.equal(result[0]?.kind, "YAT");
    assert.deepEqual(funds, [second, first]);
  });
});

test("invalid queries and malformed fund arrays are rejected", () => {
  for (const query of ["", " \t\n ", "\u0307", null, undefined, 5, {}]) {
    assert.throws(() => searchFunds([], query as string), matchesCode("INVALID_ARGUMENT"));
  }
  for (const funds of [null, {}, "", [null], [[]], [{}], [{ fundCode: "ti2", fundName: "Fund" }], [{ fundCode: "TI2", fundName: " " }]]) {
    assert.throws(
      () => searchFunds(funds as readonly { readonly fundCode: string; readonly fundName: string }[], "fund"),
      matchesCode("INVALID_ARGUMENT"),
    );
  }
});

test("empty input and unmatched searches return new empty arrays", () => {
  const empty = Object.freeze([]);
  const result = searchFunds(empty, "is");
  assert.deepEqual(result, []);
  assert.notEqual(result, empty);
  assert.deepEqual(searchFunds([{ fundCode: "TI2", fundName: "İŞ PORTFÖY" }], "nothing"), []);
});
