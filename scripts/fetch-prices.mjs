// Fetches two years of daily history for every instrument in data/universe.json
// and writes data/prices.json. No dependencies; needs Node 20+.
// A source that fails keeps its previous series, so one bad ticker never blanks the app.
import fs from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v) => Number(Number(v).toFixed(4));
const cutoff = (() => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - 2); d.setUTCDate(d.getUTCDate() - 10); return toInt(d); })();

function toInt(d) { return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); }

async function get(url, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(25000) });
      if (r.ok) return r;
      lastErr = new Error('HTTP ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120).replace(/\s+/g, ' '));
      if (r.status !== 429 && r.status < 500) break;
    } catch (e) { lastErr = new Error(String((e.cause && e.cause.message) || e.message || e)); }
    await sleep(2000 * (i + 1));
  }
  throw lastErr;
}

function finish(pairs) {
  // pairs: [dateInt, value]; keep the last value per date, sorted, inside the window
  const m = new Map();
  for (const [d, v] of pairs) if (d >= cutoff && Number.isFinite(v)) m.set(d, round(v));
  const d = [...m.keys()].sort((a, b) => a - b);
  if (d.length < 20) throw new Error('only ' + d.length + ' rows');
  return { d, v: d.map((k) => m.get(k)) };
}

export function parseYahoo(j, useAdj) {
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r || !r.timestamp) throw new Error('no data in response');
  const off = (r.meta && r.meta.gmtoffset) || 0;
  const close = r.indicators.quote[0].close;
  const adj = r.indicators.adjclose && r.indicators.adjclose[0] && r.indicators.adjclose[0].adjclose;
  const src = useAdj && adj ? adj : close;
  return r.timestamp.map((t, i) => [toInt(new Date((t + off) * 1000)), src[i] == null ? NaN : src[i]]);
}
async function yahoo(u) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(u.symbol) + '?range=2y&interval=1d&events=div%2Csplit';
  return finish(parseYahoo(await (await get(url)).json(), !!u.adj));
}

export function parseFred(text) {
  return text.split(/\r?\n/).slice(1).map((line) => {
    const [d, v] = line.split(',');
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
    return m ? [Number(m[1] + m[2] + m[3]), v === '.' || v === '' ? NaN : Number(v)] : null;
  }).filter(Boolean);
}
async function fred(u) {
  const start = String(cutoff).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  const url = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + encodeURIComponent(u.symbol) + '&cosd=' + start;
  return finish(parseFred(await (await get(url)).text()));
}

export function parseMof(text) {
  // Returns { '2Y': [[date, value], ...], ... }
  const lines = text.split(/\r?\n/);
  const hi = lines.findIndex((l) => /^\s*"?date"?\s*,/i.test(l));
  if (hi < 0) throw new Error('MoF header row not found');
  const cols = lines[hi].split(',').map((c) => c.replace(/"/g, '').trim().toUpperCase());
  const out = {};
  for (const line of lines.slice(hi + 1)) {
    const cells = line.split(',');
    const m = /^\s*"?(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(cells[0] || '');
    if (!m) continue;
    const d = Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
    cols.forEach((c, i) => {
      if (!i || !c) return;
      const raw = (cells[i] || '').replace(/"/g, '').trim();
      (out[c] = out[c] || []).push([d, /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN]);
    });
  }
  return out;
}
let mofCache = null;
async function mof(u) {
  if (!mofCache) {
    const base = 'https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/';
    const merged = {};
    for (const path of ['historical/jgbcm_all.csv', 'jgbcm.csv']) {
      const part = parseMof(await (await get(base + path)).text());
      for (const k of Object.keys(part)) merged[k] = (merged[k] || []).concat(part[k]);
    }
    mofCache = merged;
  }
  const rows = mofCache[u.symbol.toUpperCase()];
  if (!rows) throw new Error('MoF column ' + u.symbol + ' not found');
  return finish(rows);
}

const SOURCES = { yahoo, fred, mof };

async function main() {
  const universe = JSON.parse(await fs.readFile(new URL('data/universe.json', ROOT), 'utf8'));
  let prev = { series: {} };
  try { prev = JSON.parse(await fs.readFile(new URL('data/prices.json', ROOT), 'utf8')); } catch {}
  const series = {}, errors = [];
  for (const u of universe) {
    try {
      series[u.id] = await SOURCES[u.src](u);
      console.log('ok   ', u.id.padEnd(12), series[u.id].d.length, 'rows, last', series[u.id].d.at(-1));
    } catch (e) {
      errors.push({ id: u.id, symbol: u.symbol, error: String(e.message || e) });
      console.log('FAIL ', u.id.padEnd(12), u.symbol, String(e.message || e));
      if (prev.series && prev.series[u.id]) series[u.id] = prev.series[u.id];
    }
    if (u.src === 'yahoo') await sleep(400);
  }
  const ok = universe.length - errors.length;
  if (!ok) { console.log('Every source failed; leaving prices.json untouched.'); return; }
  await fs.writeFile(new URL('data/prices.json', ROOT), JSON.stringify({ updated: new Date().toISOString(), errors, series }));
  console.log(`\n${ok} of ${universe.length} instruments updated; ${errors.length} failed.`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main().catch((e) => { console.log('CRASH', e && e.stack || e); });
