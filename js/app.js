'use strict';
// 주식 연습장 공통: 저장, 탭·시장 전환, 시세 데이터 읽기, 기간, 테마, 설정, 숫자 모양, 데이터 탭
// 전략 목록은 builder.js, 결과·비교 화면과 차트는 results.js (서로 전역 변수·함수를 같이 씀)

// ---------- 저장소 ----------
// db = { version, strategies: [{ id, name, market, entry: [조건], exit, money }], costs: { kr, us }, seeded }
// prefs = 기기별 화면 상태 { theme, market, tab, period, from, to, sel: { 시장: 전략 id }, cmp: { 시장: [전략 id] } }
// 같은 주소(kkonoo.github.io)의 다른 앱과 localStorage를 같이 쓰므로 키 이름을 다르게
const KEY = 'stocklab.v1', PKEY = 'stocklab.prefs';
const readJSON = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장이 막힌 환경(사생활 보호 등)이면 이번 화면에서만 씀 */ } };
const db = readJSON(KEY) || { version: 1, strategies: [], costs: {} };
const prefs = readJSON(PKEY) || {};
const saveDb = () => writeJSON(KEY, db);
const savePrefs = () => writeJSON(PKEY, prefs);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clone = o => JSON.parse(JSON.stringify(o));

if (!db.seeded) { // 처음 열면 예시 전략을 시장마다 넣어 둠
  for (const market of ['kr', 'us']) {
    for (const s of SAMPLE_STRATEGIES) db.strategies.push({ id: uid(), market, ...clone(s), money: clone(SAMPLE_MONEY[market]) });
  }
  db.seeded = true;
  saveDb();
}
const costsFor = m => ({ ...DEFAULT_COSTS[m], ...(db.costs[m] || {}) });
const curMarket = () => prefs.market || 'kr';
const strategiesOf = m => db.strategies.filter(s => s.market === m);

// ---------- 시세 데이터: data/ 폴더의 JSON만 읽음 (시세 API를 브라우저에서 직접 부르지 않음) ----------
let watch = null, meta = {};
const getJSON = url => fetch(url, { cache: 'no-cache' }).then(r => {
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
});
const priceCache = new Map();
function loadSeries(m, ticker) {
  const k = `${m}/${ticker}`;
  if (!priceCache.has(k)) {
    priceCache.set(k, getJSON(`data/prices/${k}.json`).then(d => Engine.fromRows(d.rows))
      .catch(e => { priceCache.delete(k); throw e; })); // 실패는 기억하지 않음 (다음에 다시 시도)
  }
  return priceCache.get(k);
}
const stocksOf = m => watch?.[m]?.stocks || [];
const benchOf = m => watch?.[m]?.benchmark || null;
const lastDate = m => Object.values(meta[m] || {}).reduce((a, x) => (x.last > a ? x.last : a), '');

// ---------- 기간: 결과·비교 탭이 같이 씀 ----------
const PERIODS = [['all', '전체'], ['5y', '5년'], ['3y', '3년'], ['1y', '1년']];
function periodRange(m) {
  const p = prefs.period || 'all', end = lastDate(m);
  if (p === 'custom') return { from: prefs.from || '', to: prefs.to || '9999-12-31' };
  if (p === 'all' || !end) return { from: '', to: '9999-12-31' };
  const d = new Date(end);
  d.setUTCFullYear(d.getUTCFullYear() - parseInt(p, 10));
  return { from: d.toISOString().slice(0, 10), to: '9999-12-31' };
}
function periodControl(m) {
  const box = h('div', 'period');
  const seg = h('div', 'seg');
  for (const [id, label] of PERIODS) {
    const b = button(label, () => { prefs.period = id; savePrefs(); render(); });
    b.classList.toggle('on', (prefs.period || 'all') === id);
    seg.append(b);
  }
  const { from, to } = periodRange(m);
  const first = Object.values(meta[m] || {}).reduce((a, x) => (!a || x.first < a ? x.first : a), '');
  const date = (value, key, label) => {
    const i = h('input');
    Object.assign(i, { type: 'date', value, title: label });
    i.setAttribute('aria-label', label);
    i.addEventListener('change', () => {
      const r = periodRange(m);
      Object.assign(prefs, { period: 'custom', from: r.from, to: r.to === '9999-12-31' ? lastDate(m) : r.to, [key]: i.value });
      savePrefs();
      render();
    });
    return i;
  };
  box.append(seg, h('span', 'dates', date(from || first, 'from', '시작일'), h('span', 'muted', '~'), date(to === '9999-12-31' ? lastDate(m) : to, 'to', '종료일')));
  return box;
}

// ---------- 숫자 모양 ----------
const fmtNum = (v, d = 0) => v.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtMoney = (v, m) => (m === 'us' ? `$${fmtNum(v, 2)}` : `${fmtNum(Math.round(v))}원`);
// 짧게: 1,023만 원 · 4.97억 원 · $10,540 (지표 카드·차트 눈금용)
function fmtMoneyShort(v, m) {
  const a = Math.abs(v);
  if (m === 'us') return `$${fmtNum(v, a >= 1e4 || Number.isInteger(v) ? 0 : 2)}`;
  const upTo = (x, d) => x.toLocaleString('ko-KR', { maximumFractionDigits: d }); // 소수점은 있을 때만
  if (a >= 1e8) return `${upTo(v / 1e8, 2)}억 원`;
  if (a >= 1e4) return `${upTo(v / 1e4, a >= 1e7 ? 0 : 1)}만 원`;
  return `${fmtNum(Math.round(v))}원`;
}
const fmtPrice = (v, m) => (m === 'us' ? fmtNum(v, 2) : fmtNum(Math.round(v)));
function fmtPct(v, d = 1) {
  if (v == null || !isFinite(v)) return '–';
  const r = +v.toFixed(d);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(d)}%`;
}
const tone = v => (v > 0.0001 ? 'up' : v < -0.0001 ? 'down' : ''); // 빨강 = 오름, 파랑 = 내림 (국내 관례)

// ---------- 화면 도구 ----------
const $ = id => document.getElementById(id);
// h('div', 'cls', '글자', 노드, …) — 글자는 textContent로만 넣음 (종목 이름 등 바깥 데이터)
function h(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
}
function button(label, onClick, cls = 'btn') {
  const b = h('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

// ---------- 탭·시장 ----------
const VIEWS = {
  strategies: () => renderStrategies(),
  results: () => renderResults(),
  compare: () => renderCompare(),
  data: () => renderData(),
};
function render() {
  const tab = VIEWS[prefs.tab] ? prefs.tab : 'results', m = curMarket();
  document.body.dataset.tab = tab;
  for (const b of $('tabSeg').children) b.classList.toggle('on', b.dataset.tab === tab);
  for (const b of $('marketSeg').children) b.classList.toggle('on', b.dataset.market === m);
  $('asOf').textContent = lastDate(m) ? `데이터 ${lastDate(m)}까지` : '';
  if (!watch) return;
  VIEWS[tab]();
}
function setTab(tab) { prefs.tab = tab; savePrefs(); render(); window.scrollTo(0, 0); }
for (const b of $('tabSeg').children) b.addEventListener('click', () => setTab(b.dataset.tab));
for (const b of $('marketSeg').children) b.addEventListener('click', () => { prefs.market = b.dataset.market; savePrefs(); render(); });

// ---------- 테마 ----------
function applyTheme() {
  if (prefs.theme) document.documentElement.dataset.theme = prefs.theme;
  else delete document.documentElement.dataset.theme;
  $('themeColor').content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
}
$('themeBtn').addEventListener('click', () => {
  const dark = prefs.theme ? prefs.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  prefs.theme = dark ? 'light' : 'dark';
  savePrefs();
  applyTheme();
  render(); // 차트 색을 새 테마로
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!prefs.theme) { applyTheme(); render(); } });

// ---------- ⚙️ 설정: 시장별 비용 ----------
const COST_FIELDS = [['buyFee', '매수 수수료'], ['sellFee', '매도 수수료'], ['sellTax', '매도 세금'], ['slippage', '슬리피지']];
function renderSettings() {
  const box = $('costFields');
  box.replaceChildren();
  for (const [m, label] of [['kr', '🇰🇷 국내'], ['us', '🇺🇸 미국']]) {
    const fs = h('fieldset', 'costs', h('legend', '', label));
    const c = costsFor(m);
    for (const [key, name] of COST_FIELDS) {
      const input = h('input');
      Object.assign(input, { type: 'number', min: 0, step: 0.001, value: c[key], inputMode: 'decimal' });
      input.addEventListener('change', () => {
        const v = parseFloat(input.value);
        if (!(v >= 0)) { input.value = costsFor(m)[key]; return; }
        db.costs[m] = { ...costsFor(m), [key]: v };
        saveDb();
      });
      fs.append(h('label', 'field', h('span', '', name), h('span', 'unit-input', input, h('span', 'unit', '%'))));
    }
    fs.append(button('기본값으로', () => { delete db.costs[m]; saveDb(); renderSettings(); }, 'btn small ghost'));
    box.append(fs);
  }
}
$('settingsBtn').addEventListener('click', () => { renderSettings(); $('themeSelect').value = prefs.theme || ''; $('settings').showModal(); });
$('themeSelect').addEventListener('change', e => {
  if (e.target.value) prefs.theme = e.target.value; else delete prefs.theme;
  savePrefs();
  applyTheme();
});
$('settings').addEventListener('close', render); // 바뀐 비용으로 다시 계산

// ---------- 📁 데이터 탭 ----------
function renderData() {
  const m = curMarket(), view = $('dataView'), last = lastDate(m);
  const rows = [[benchOf(m), '벤치마크'], ...stocksOf(m).map(s => [s, '관심 종목'])].filter(([s]) => s);
  const table = h('table', 'grid-table');
  table.append(h('thead', '', h('tr', '', ...['구분', '종목', '데이터 시작', '마지막 데이터', '상태'].map(t => h('th', '', t)))));
  const body = h('tbody');
  for (const [s, kind] of rows) {
    const x = meta[m]?.[s.ticker];
    const state = !x ? '⏳ 아직 없어요' : x.last < last ? '⚠️ 다른 종목보다 늦어요 (수집 실패?)' : '✅';
    body.append(h('tr', '', h('td', 'muted', kind), h('td', '', s.name || s.ticker, ' ', h('span', 'muted', s.ticker)),
      h('td', 'num', x?.first || '–'), h('td', 'num', x?.last || '–'), h('td', '', state)));
  }
  table.append(body);
  view.replaceChildren(
    h('h2', '', '📁 데이터'),
    h('p', 'muted', '매일 장 마감 후 GitHub Actions가 수정주가 일봉을 받아요. 관심 종목은 GitHub의 data/watchlist.json에서 고쳐요.'),
    h('div', 'table-wrap card', table),
    m === 'kr' ? h('p', 'note', 'ℹ️ 국내 수정주가는 분할·병합·증자만 반영하고 배당은 빠져 있어요.') : null,
  );
}

// ---------- 시작 ----------
async function init() {
  applyTheme();
  render();
  try {
    [watch, meta] = await Promise.all([getJSON('data/watchlist.json'), getJSON('data/meta.json').catch(() => ({}))]);
  } catch (e) {
    $('main').replaceChildren(h('p', 'note warn', `⚠️ 관심 종목 목록을 못 읽었어요 (${e.message}). 인터넷 연결을 확인하고 새로고침해 주세요.`));
    return;
  }
  render();
}
document.addEventListener('DOMContentLoaded', init);
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
