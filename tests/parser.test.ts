import test from "node:test";
import assert from "node:assert/strict";
import { parsePriceHistory } from "../dist/parser.js";
import { envelope, row, matchesCode } from "./helpers.js";

const parse = (payload: unknown) => parsePriceHistory(payload, "TI2", "1y");

test("parser sorts, deduplicates and preserves the source input", () => {
  const input = envelope([row("2026-10-20", 2), row("2026-10-19", 1), row("2026-10-19", 1)]);
  const original = structuredClone(input);
  assert.deepEqual(parse(input), {
    fundCode: "TI2",
    fundName: "Example Fund",
    period: "1y",
    periodMonths: 12,
    prices: [
      { date: "2026-10-19", price: 1 },
      { date: "2026-10-20", price: 2 },
    ],
    returnedDateRange: { from: "2026-10-19", to: "2026-10-20" },
  });
  assert.deepEqual(input, original);
});

test("empty history is a valid result without an invented date range", () => {
  assert.deepEqual(parse(envelope()), {
    fundCode: "TI2",
    fundName: null,
    period: "1y",
    periodMonths: 12,
    prices: [],
    returnedDateRange: null,
  });
  for (const errorCode of [null, 0, "0"]) {
    assert.deepEqual(parse(envelope([], { errorCode })).prices, []);
  }
});

test("source errors preserve the source code", () => {
  assert.throws(
    () => parse({ errorCode: 7, errorMessage: "Example failure" }),
    (error) => matchesCode("SOURCE_ERROR")(error) && error.sourceCode === 7,
  );
  assert.throws(() => parse(envelope([], { errorMessage: "Failure" })), matchesCode("SOURCE_ERROR"));
});

test("malformed envelopes and error messages are rejected", () => {
  for (const payload of [
    null,
    [],
    42,
    {},
    { resultList: [] },
    { errorCode: null, errorMessage: null },
    envelope(null),
    envelope([], { errorCode: false }),
    envelope([], { errorCode: NaN }),
    envelope([], { errorCode: "" }),
    envelope([], { errorMessage: 5 }),
    envelope([], { errorMessage: undefined }),
    envelope([], { errorMessage: {} }),
    envelope([null]),
    envelope([[]]),
  ]) {
    assert.throws(() => parse(payload), matchesCode("INVALID_RESPONSE"));
  }
});

test("invalid rows and conflicting metadata are rejected", () => {
  for (const extra of [
    { fonKodu: "OTHER" },
    { fonUnvan: "" },
    { fonUnvan: null },
    { tarih: "2026-02-30" },
    { tarih: "2026-10-19T00:00:00Z" },
    { tarih: "2026-2-1" },
    { fiyat: "1.23" },
    { fiyat: null },
    { fiyat: -1 },
    { fiyat: NaN },
    { fiyat: Infinity },
  ]) {
    assert.throws(() => parse(envelope([row("2026-10-19", 1, extra)])), matchesCode("INVALID_RESPONSE"));
  }
  for (const rows of [
    [row("2026-10-19", 1), row("2026-10-19", 2)],
    [row("2026-10-19", 1), row("2026-10-20", 2, { fonUnvan: "Another Fund" })],
  ]) {
    assert.throws(() => parse(envelope(rows)), matchesCode("INVALID_RESPONSE"));
  }
  const first = parse(envelope([row("2024-02-29", 0)])).prices[0];
  assert.ok(first);
  assert.equal(first.price, 0);
});
