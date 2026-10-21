import test from "node:test";
import assert from "node:assert/strict";
import {
  isDateString, isFundCode, isFundKind, isNonEmptyString, isNonNegativeNumber, isPercentage, normalizeFundCode,
} from "../dist/validation.js";
import { matchesCode } from "./helpers.js";

test("shared date and fund validators reject malformed values without coercion", () => {
  assert.equal(isDateString("2024-02-29"), true);
  for (const value of ["2026-02-29", "2026-04-31", "2026-2-01", "2026-01-01T00:00:00Z", null, 20261020]) {
    assert.equal(isDateString(value), false);
  }
  assert.equal(isFundCode("TI2"), true);
  assert.equal(normalizeFundCode(" ti2 "), "TI2");
  for (const value of ["Tİ2", "TI-2", "T I2", "TOOLONG", null, 123]) {
    assert.equal(isFundCode(value), false);
    assert.throws(() => normalizeFundCode(value), matchesCode("INVALID_ARGUMENT"));
  }
  for (const kind of ["YAT", "EMK", "BYF", "GYF", "GSYF"]) assert.equal(isFundKind(kind), true);
  for (const value of ["yat", "F", "M", "", null, 1]) assert.equal(isFundKind(value), false);
});

test("shared numeric and text validators preserve zero and reject missing or non-finite values", () => {
  for (const value of [0, 1.5, 100]) {
    assert.equal(isNonNegativeNumber(value), true);
    assert.equal(isPercentage(value), true);
  }
  assert.equal(isNonNegativeNumber(100.01), true);
  assert.equal(isPercentage(100.01), false);
  for (const value of [null, undefined, "0", -1, NaN, Infinity, -Infinity]) {
    assert.equal(isNonNegativeNumber(value), false);
    assert.equal(isPercentage(value), false);
  }
  assert.equal(isNonEmptyString(" İŞ PORTFÖY "), true);
  for (const value of ["", " \t\n", null, undefined, 1]) assert.equal(isNonEmptyString(value), false);
});
