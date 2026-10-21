import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { TefasError } from "../dist/errors.js";
import { parseRetryAfter, getRetryDelay, waitForRetry } from "../dist/retry.js";

test("Retry-After accepts seconds and supported dates conservatively", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  assert.equal(parseRetryAfter(null, now), undefined);
  assert.equal(parseRetryAfter("2", now), 2000);
  assert.equal(parseRetryAfter("Tue, 20 Oct 2026 12:00:10 GMT", now), 10_000);
  assert.equal(parseRetryAfter("Tue, 20 Oct 2026 11:59:00 GMT", now), 0);
  for (const value of ["", "1.5", "-1", "not a date", "999999999999999999999"]) {
    assert.equal(parseRetryAfter(value, now), Infinity);
  }
});

test("retry policy selects temporary failures and respects server wait", () => {
  for (const status of [429, 502, 503, 504]) {
    assert.equal(
      getRetryDelay(new TefasError("HTTP_ERROR", "Temporary", { status }), 0, () => 0.5),
      250,
    );
  }
  for (const error of [
    new Error("Unknown"),
    new TefasError("HTTP_ERROR", "Failure", { status: 500 }),
    ...["INVALID_ARGUMENT", "ACCESS_DENIED", "SOURCE_ERROR", "INVALID_RESPONSE", "TIMEOUT", "ABORTED"].map(
      (code) => new TefasError(code, "Failure"),
    ),
  ]) {
    assert.equal(getRetryDelay(error, 0), undefined);
  }
  const network = new TefasError("NETWORK_ERROR", "Connection failed");
  assert.equal(
    getRetryDelay(network, 0, () => 0.5),
    250,
  );
  assert.equal(
    getRetryDelay(network, 1, () => 0.5),
    500,
  );
  assert.equal(
    getRetryDelay(network, 10, () => 0.5),
    2000,
  );
  assert.equal(
    getRetryDelay(
      new TefasError("HTTP_ERROR", "Wait", {
        status: 503,
        retryAfterMs: 2000,
      }),
      0,
      () => 0,
    ),
    2000,
  );
  for (const retryAfterMs of [60_001, Infinity]) {
    assert.equal(
      getRetryDelay(
        new TefasError("HTTP_ERROR", "Too long", {
          status: 503,
          retryAfterMs,
        }),
        0,
      ),
      undefined,
    );
  }
});

test("retry waits support cancellation and remove listeners", async () => {
  const complete = new AbortController();
  await waitForRetry(1, complete.signal);
  assert.equal(getEventListeners(complete.signal, "abort").length, 0);

  const cancelled = new AbortController();
  const reason = new Error("Stop waiting");
  const waiting = waitForRetry(60_000, cancelled.signal);
  const check = assert.rejects(waiting, (error) => error === reason);
  cancelled.abort(reason);
  await check;
  assert.equal(getEventListeners(cancelled.signal, "abort").length, 0);
  await assert.rejects(waitForRetry(60_000, cancelled.signal), (error) => error === reason);
});
