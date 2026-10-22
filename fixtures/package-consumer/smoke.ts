import assert from 'node:assert/strict';
import type { HistoryPeriodMonths } from 'tefas-js';

const originalFetch = globalThis.fetch;
let calls = 0;
const expectedPeriods = [12, 13, 0];

globalThis.fetch = async (url, init) => {
  calls += 1;
  assert.ok(init);
  assert.ok(typeof init.body === 'string');
  if (url === 'https://www.tefas.gov.tr/api/statistics/tefas/getFplFonList') {
    assert.deepEqual(JSON.parse(init.body), {});
    return Response.json({
      errorCode: null, errorMessage: null, error: false,
      data: [{ fonKod: 'TI2', unvan: 'İŞ PORTFÖY', kurucuKod: 'IPY', kurucuAd: 'İŞ PORTFÖY YÖNETİMİ A.Ş.' }],
    });
  }
  assert.equal(url, 'https://www.tefas.gov.tr/api/funds/fonFiyatBilgiGetir');
  assert.deepEqual(JSON.parse(init.body), { fonKodu: 'TI2', dil: 'TR', periyod: expectedPeriods[calls - 1] });
  return Response.json({
    errorCode: null,
    errorMessage: null,
    resultList: [
      { fonKodu: 'TI2', fonUnvan: 'Example Fund', tarih: '2026-10-20', fiyat: 2 },
      { fonKodu: 'TI2', fonUnvan: 'Example Fund', tarih: '2026-10-19', fiyat: 1 },
    ],
  });
};

try {
  const { TefasClient, TefasError, searchFunds } = await import('tefas-js');
  const client = new TefasClient({ timeoutMs: 1000, maxRetries: 0 });
  assert.equal(calls, 0);

  const history = await client.getPriceHistory(' ti2 ', { periodMonths: 12 });
  assert.equal(calls, 1);
  assert.deepEqual(history, {
    fundCode: 'TI2', fundName: 'Example Fund', period: '1y', periodMonths: 12,
    prices: [{ date: '2026-10-19', price: 1 }, { date: '2026-10-20', price: 2 }],
    returnedDateRange: { from: '2026-10-19', to: '2026-10-20' },
  });

  const weekly = await client.getPriceHistory('TI2', { period: '1w' });
  assert.equal(weekly.period, '1w');
  assert.equal(weekly.periodMonths, null);
  const ytd = await client.getPriceHistory('TI2', { period: 'ytd' });
  assert.equal(ytd.period, 'ytd');
  assert.equal(ytd.periodMonths, null);
  assert.equal(calls, 3);

  await assert.rejects(
    () => client.getPriceHistory('TI2', { periodMonths: 2 as HistoryPeriodMonths }),
    (error) => error instanceof TefasError && error.code === 'INVALID_ARGUMENT',
  );
  assert.equal(calls, 3);
  const funds = await client.listFunds();
  assert.equal(calls, 4);
  assert.deepEqual(funds, [{
    fundCode: 'TI2', fundName: 'İŞ PORTFÖY', founderCode: 'IPY', founderName: 'İŞ PORTFÖY YÖNETİMİ A.Ş.',
  }]);
  const found = searchFunds(funds, 'is');
  assert.equal(found[0], funds[0]);
  assert.equal(calls, 4);
  console.log('Consumer JavaScript OK');
} finally {
  globalThis.fetch = originalFetch;
}
