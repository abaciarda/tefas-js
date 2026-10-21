import assert from "node:assert/strict";
import { TefasError } from "../dist/errors.js";
import type { TefasErrorCode } from "../dist/errors.js";

export const row = (date: string, price: number, extra: Record<string, unknown> = {}) => ({
  fonKodu: "TI2",
  fonUnvan: " Example Fund ",
  tarih: date,
  fiyat: price,
  ...extra,
});

export const envelope = (rows: unknown = [], extra: Record<string, unknown> = {}) => ({
  errorCode: null,
  errorMessage: null,
  resultList: rows,
  ...extra,
});

export const matchesCode = (code: TefasErrorCode) => (error: unknown): error is TefasError =>
  error instanceof TefasError && error.code === code;

export type TestFetcher = (url: string, init: RequestInit & { body: string; signal: AbortSignal }) => Promise<Response>;

export async function withFetch<T>(fetcher: TestFetcher, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.ok(typeof url === "string");
    assert.ok(init);
    assert.ok(typeof init.body === "string");
    assert.ok(init.signal instanceof AbortSignal);
    return fetcher(url, { ...init, body: init.body, signal: init.signal });
  };
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

export const pendingFetch: TestFetcher = (_url, init) => {
  const signal = init.signal;
  return new Promise<Response>((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
};
