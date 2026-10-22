import assert from 'node:assert/strict';
import type { HistoryPeriodMonths } from 'tefas-js';

const originalFetch = globalThis.fetch;
let calls = 0;
const expectedPeriods = [12, 13, 0];

globalThis.fetch = async (url, init) => {
  calls += 1;
  assert.ok(init);
  assert.ok(typeof init.body === 'string');
  if (url === 'https://www.tefas.gov.tr/api/funds/dagilimSiraliGetirT') {
    const body = JSON.parse(init.body) as { fonKodu: string; fonKod: string; fonTipi: string; basTarih: string; bitTarih: string };
    assert.equal(body.fonKodu, 'TI2');
    assert.equal(body.fonKod, 'TI2');
    assert.equal(body.fonTipi, 'YAT');
    assert.equal(body.basTarih, '20261020');
    assert.equal(body.bitTarih, '20261020');
    return Response.json({
      errorCode: null, errorMessage: null,
      resultList: [{ fonKodu: 'TI2', fonUnvan: 'İŞ PORTFÖY', tarih: '2026-10-20', hs: 90, tr: 10, dt: null }],
    });
  }
  if (url === 'https://www.tefas.gov.tr/api/funds/fonGnlBlgSiraliGetir') {
    const body = JSON.parse(init.body) as { fonKodu: string | null; fonTipi: string; basTarih: string; bitTarih: string };
    assert.equal(body.fonTipi, 'YAT');
    assert.equal(body.basTarih, '20261020');
    assert.equal(body.bitTarih, '20261020');
    assert.ok(body.fonKodu === null || body.fonKodu === 'TI2');
    const rows = [
      { fonKodu: 'TI2', fonUnvan: 'İŞ PORTFÖY', tarih: '2026-10-20', fiyat: 2, tedPaySayisi: 100, kisiSayisi: 10, portfoyBuyukluk: 200 },
      { fonKodu: 'AAA', fonUnvan: 'Other Fund', tarih: '2026-10-20', fiyat: 1, tedPaySayisi: null, kisiSayisi: 20, portfoyBuyukluk: 100 },
    ];
    return Response.json({ errorCode: null, errorMessage: null, resultList: body.fonKodu === null ? rows : rows.slice(0, 1) });
  }
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
  const { TefasClient, TefasError, searchFunds, topFunds, summarizeMarket } = await import('tefas-js');
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
  const snapshot = await client.getSnapshot('TI2', { date: '2026-10-20' });
  assert.deepEqual(snapshot, {
    fundCode: 'TI2', fundName: 'İŞ PORTFÖY', kind: 'YAT', date: '2026-10-20', price: 2,
    sharesOutstanding: 100, investorCount: 10, portfolioSize: 200,
  });
  const snapshots = await client.getSnapshots({ date: '2026-10-20' });
  assert.equal(calls, 6);
  assert.deepEqual(snapshots.map((fund) => fund.fundCode), ['AAA', 'TI2']);
  assert.equal(snapshots[0]?.sharesOutstanding, null);
  assert.equal(topFunds(snapshots, { by: 'portfolioSize', limit: 1 })[0]?.fundCode, 'TI2');
  assert.deepEqual(summarizeMarket(snapshots), {
    kind: 'YAT', date: '2026-10-20', fundCount: 2, totalPortfolioSize: 300, totalInvestorCount: 30,
  });
  assert.equal(searchFunds(snapshots, 'is')[0]?.investorCount, 10);
  assert.equal(calls, 6);
  const allocation = await client.getAllocation('TI2', { date: '2026-10-20' });
  assert.deepEqual(allocation, {
    fundCode: 'TI2', fundName: 'İŞ PORTFÖY', kind: 'YAT', date: '2026-10-20', weights: { stock: 90, reverseRepo: 10 },
  });
  assert.equal(calls, 7);
  console.log('Consumer JavaScript OK');
} finally {
  globalThis.fetch = originalFetch;
}
