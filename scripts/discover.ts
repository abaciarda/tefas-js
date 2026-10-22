import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

type JsonRecord = Record<string, unknown>;
type Probe = { readonly name: string; readonly endpoint: string; readonly body: JsonRecord; readonly sampleSize?: number };

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtureDirectory = join(root, 'tests', 'fixtures');
const date = process.argv[2] ?? '20261020';
const selected = process.argv.slice(3);

function dailyBody(fundCode: string | null, kind = 'YAT', day = date, to = day): JsonRecord {
  return {
    fonTipi: kind, fonKodu: fundCode, aramaMetni: null, fonTurKod: null,
    fonGrubu: null, sfonTurKod: null, fonTurAciklama: null, kurucuKod: null,
    basTarih: day, bitTarih: to, basSira: 1, bitSira: 100000,
    dil: 'TR', sFonTurKod: '', fonKod: '', fonGrup: '', fonUnvanTip: '',
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function fields(value: unknown): JsonRecord | null {
  return isRecord(value) ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, describe(entry)])) : null;
}

function sample(value: unknown, limit: number): unknown {
  if (Array.isArray(value)) return value.slice(0, limit).map((entry) => sample(entry, limit));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sample(entry, limit)]));
  return value;
}

const probes: readonly Probe[] = [
  { name: 'fonFiyatBilgiGetir-week', endpoint: '/api/funds/fonFiyatBilgiGetir', body: { fonKodu: 'TI2', dil: 'TR', periyod: 13 } },
  { name: 'fonFiyatBilgiGetir-ytd', endpoint: '/api/funds/fonFiyatBilgiGetir', body: { fonKodu: 'TI2', dil: 'TR', periyod: 0 } },
  { name: 'getFplFonList', endpoint: '/api/statistics/tefas/getFplFonList', body: {} },
  { name: 'fonGnlBlgSiraliGetir-single', endpoint: '/api/funds/fonGnlBlgSiraliGetir', body: dailyBody('TI2') },
  { name: 'fonGnlBlgSiraliGetir-pension', endpoint: '/api/funds/fonGnlBlgSiraliGetir', body: dailyBody('AE1', 'EMK') },
  { name: 'fonGnlBlgSiraliGetir-all', endpoint: '/api/funds/fonGnlBlgSiraliGetir', body: dailyBody(null), sampleSize: 5 },
  { name: 'fonGnlBlgSiraliGetir-weekend', endpoint: '/api/funds/fonGnlBlgSiraliGetir', body: dailyBody('TI2', 'YAT', '20261018') },
  { name: 'fonGnlBlgSiraliGetir-range', endpoint: '/api/funds/fonGnlBlgSiraliGetir', body: dailyBody('TI2', 'YAT', '20260901', '20260928'), sampleSize: 50 },
  { name: 'dagilimSiraliGetirT', endpoint: '/api/funds/dagilimSiraliGetirT', body: dailyBody('TI2') },
  { name: 'dagilimSiraliGetirT-both-codes', endpoint: '/api/funds/dagilimSiraliGetirT', body: { ...dailyBody('TI2'), fonKod: 'TI2' } },
  { name: 'dagilimSiraliGetirT-weekend', endpoint: '/api/funds/dagilimSiraliGetirT', body: { ...dailyBody('TI2', 'YAT', '20261018'), fonKod: 'TI2' } },
  { name: 'dagilimSiraliGetirT-fonKod-only', endpoint: '/api/funds/dagilimSiraliGetirT', body: { ...dailyBody(null), fonKod: 'TI2' } },
  { name: 'dagilimSiraliGetirT-search', endpoint: '/api/funds/dagilimSiraliGetirT', body: { ...dailyBody('TI2'), aramaMetni: 'TI2' } },
  { name: 'fonProfilDtyGetir', endpoint: '/api/funds/fonProfilDtyGetir', body: { fonKodu: 'TI2', dil: 'TR', periyod: 12 }, sampleSize: 50 },
  { name: 'fonProfilDtyGetir-week', endpoint: '/api/funds/fonProfilDtyGetir', body: { fonKodu: 'TI2', dil: 'TR', periyod: 13 }, sampleSize: 50 },
  { name: 'fonFiyatBilgiGetir-week-full', endpoint: '/api/funds/fonFiyatBilgiGetir', body: { fonKodu: 'TI2', dil: 'TR', periyod: 13 }, sampleSize: 50 },
  { name: 'fonTipiGetir', endpoint: '/api/funds/fonTipiGetir', body: { fonKodu: 'TI2' } },
  { name: 'fonTipiGetir-pension', endpoint: '/api/funds/fonTipiGetir', body: { fonKodu: 'AE1' } },
  { name: 'fonTipiGetir-missing', endpoint: '/api/funds/fonTipiGetir', body: { fonKodu: 'ZZZ' } },
];

mkdirSync(fixtureDirectory, { recursive: true });
const blockedEndpoints = new Set<string>();
const reportPath = join(fixtureDirectory, 'discovery-report.json');
const report: JsonRecord[] = selected.length > 0 && existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) as JsonRecord[] : [];
let sent = false;
for (const probe of probes) {
  if (selected.length > 0 && !selected.includes(probe.name)) continue;
  if (blockedEndpoints.has(probe.endpoint)) continue;
  if (sent) await delay(12_000);
  sent = true;
  let response: Response;
  let body: string;
  try {
    response = await fetch(`https://www.tefas.gov.tr${probe.endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(probe.body),
      signal: AbortSignal.timeout(15_000),
    });
    body = await response.text();
  } catch (error) {
    console.error('Discovery could not reach TEFAS. Check your network connection.', error);
    process.exitCode = 1;
    break;
  }
  const contentType = response.headers.get('Content-Type');
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    const result = { name: probe.name, status: response.status, contentType, rejected: true, preview: body.slice(0, 200) };
    report.push(result);
    console.log(JSON.stringify(result));
    blockedEndpoints.add(probe.endpoint);
    process.exitCode = 1;
    continue;
  }
  const rows = Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload.resultList) ? payload.resultList : isRecord(payload) && Array.isArray(payload.data) ? payload.data : null;
  const result = {
    name: probe.name, status: response.status, contentType, topLevel: fields(payload) ?? describe(payload),
    rowCount: rows?.length ?? null, firstRow: fields(rows?.[0]),
    sourceCode: isRecord(payload) ? payload.errorCode ?? null : null,
    sourceMessage: isRecord(payload) ? payload.errorMessage ?? null : null,
    ...(probe.endpoint === '/api/funds/dagilimSiraliGetirT' && rows?.some((row: unknown) => isRecord(row) && 'bilFiyat' in row) ? {
      ignoredMetadataFields: { bilFiyat: 'Not a percentage; excluded from allocation weights and totals.' },
    } : {}),
    ...(probe.name.startsWith('dagilimSiraliGetirT-') ? {
      matchingRows: rows?.filter((row: unknown) => isRecord(row) && row.fonKodu === 'TI2').length ?? null,
      exclusivelyRequestedFund: rows !== null && rows.length > 0 && rows.every((row: unknown) => isRecord(row) && row.fonKodu === 'TI2'),
    } : {}),
  };
  const previous = report.findIndex((entry) => entry.name === probe.name);
  if (previous !== -1) report.splice(previous, 1);
  report.push(result);
  console.log(JSON.stringify(result));
  writeFileSync(join(fixtureDirectory, `${probe.name}.json`), `${JSON.stringify(sample(payload, probe.sampleSize ?? 3), null, 2)}\n`);
  if (!response.ok) {
    blockedEndpoints.add(probe.endpoint);
    process.exitCode = 1;
  }
}
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
