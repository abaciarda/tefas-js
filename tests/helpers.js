import { TefasError } from "../dist/errors.js";

export const row = (date, price, extra = {}) => ({
  fonKodu: "TI2",
  fonUnvan: " Example Fund ",
  tarih: date,
  fiyat: price,
  ...extra,
});

export const envelope = (rows = [], extra = {}) => ({
  errorCode: null,
  errorMessage: null,
  resultList: rows,
  ...extra,
});

export const matchesCode = (code) => (error) => error instanceof TefasError && error.code === code;

export async function withFetch(fetcher, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

export function pendingFetch(_url, init) {
  const signal = init.signal;
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}
