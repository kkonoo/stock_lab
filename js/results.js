'use strict';
// 📊 결과 · ⚖️ 비교 탭: 백테스트 실행, 지표 카드, 자산 곡선, 거래 표, 종목 캔들 차트
// 차트: lightweight-charts (index.html에서 CDN, 버전 고정)

const REASONS = { tp: '🎯 익절', sl: '🛑 손절', time: '⏰ 기간만료', open: '📌 보유 중' };
const MARKER_TEXT = { tp: '익절', sl: '손절', time: '만료' };

// ---------- 백테스트 실행 ----------
// 관심 종목 전체(목록 순서)를 그 시장 비용·기간으로 돌림. 시세 파일이 없는 종목은 빼고 missing에 적음
async function backtest(strategy) {
  const m = strategy.market, missing = [];
  const load = t => loadSeries(m, t).catch(() => { missing.push(t); return null; });
  const list = stocksOf(m), b = benchOf(m);
  const [series, bs] = await Promise.all([Promise.all(list.map(s => load(s.ticker))), b ? load(b.ticker) : null]);
  const stocks = list.map((s, i) => ({ ticker: s.ticker, name: s.name || s.ticker, series: series[i] })).filter(s => s.series);
  const benchmark = bs ? { ticker: b.ticker, name: b.name || b.ticker, series: bs } : null;
  return { res: Engine.run({ stocks, benchmark, strategy, costs: costsFor(m), ...periodRange(m) }), stocks, benchmark, missing };
}

// ---------- 색: CSS 변수에서 읽음 (테마를 바꾸면 다시 그림) ----------
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
// 전략 색은 그 시장 전략 목록 순서로 고정 (색이 전략을 따라다님). 2번(주황)은 벤치마크 몫
const STRATEGY_SLOTS = [1, 3, 4, 5, 6, 7, 8];
const slotOf = s => STRATEGY_SLOTS[strategiesOf(s.market).indexOf(s) % STRATEGY_SLOTS.length];
const BENCH_COLOR = () => cssVar('--s2');

// ---------- 차트 공통 ----------
let liveCharts = [];
function disposeCharts() { liveCharts.forEach(c => c.remove()); liveCharts = []; }
function makeChart(box, priceFormatter) {
  const chart = LightweightCharts.createChart(box, {
    autoSize: true,
    layout: { background: { type: 'solid', color: cssVar('--surface') }, textColor: cssVar('--muted'), fontFamily: getComputedStyle(document.body).fontFamily, attributionLogo: true },
    grid: { vertLines: { visible: false }, horzLines: { color: cssVar('--grid') } },
    rightPriceScale: { borderColor: cssVar('--axis') },
    timeScale: { borderColor: cssVar('--axis'), minBarSpacing: 0.05 }, // 10년치(약 2,500일)도 한 화면에 다 보이게
    crosshair: { vertLine: { color: cssVar('--axis') }, horzLine: { color: cssVar('--axis') } },
    localization: { locale: 'ko-KR', priceFormatter, dateFormat: 'yyyy-MM-dd' },
  });
  liveCharts.push(chart);
  return chart;
}
// 차트가 돌려주는 시간 → 'YYYY-MM-DD' (넣은 형식 그대로 오거나 { year, month, day }로 올 수 있음)
const timeStr = t => (typeof t === 'string' ? t : `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`);
// 위쪽 읽기 줄: 마우스를 올린 날짜의 값 (안 올렸으면 마지막 날). 값이 먼저, 이름은 뒤에
function readout(head, items) {
  const date = h('span', 'legend-date');
  const cells = items.map(it => {
    const val = h('strong', '');
    head.append(h('span', 'legend-item', h('i', 'key', ''), val, h('span', 'muted', it.name)));
    head.lastChild.firstChild.style.background = it.color;
    return val;
  });
  head.prepend(date);
  return (time, values) => {
    date.textContent = time || '';
    values.forEach((v, i) => { cells[i].textContent = v == null ? '–' : items[i].fmt(v); });
  };
}

// 선 차트: lines = [{ name, color, data: [{ time, value }] }]
function lineChart(card, lines, fmt, axisFmt = fmt) {
  const head = h('div', 'chart-legend'), box = h('div', 'chart-box');
  card.append(head, box);
  const chart = makeChart(box, axisFmt);
  const direct = lines.length <= 4; // 4개 이하면 오른쪽 끝에도 이름표
  const api = lines.map(l => {
    const s = chart.addSeries(LightweightCharts.LineSeries, {
      color: l.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: direct, title: direct ? l.short || l.name : '', crosshairMarkerRadius: 4,
    });
    s.setData(l.data);
    return s;
  });
  chart.timeScale().fitContent();
  const show = readout(head, lines.map(l => ({ name: l.name, color: l.color, fmt })));
  const last = () => show(lines[0].data.at(-1)?.time, lines.map(l => l.data.at(-1)?.value));
  chart.subscribeCrosshairMove(p => (p.time ? show(timeStr(p.time), api.map(s => p.seriesData.get(s)?.value)) : last()));
  last();
}

// 캔들 차트 + 거래량 + 매수·매도 표시. focus = 확대해서 보여 줄 거래
function candleChart(card, m, stock, trades, focus) {
  const head = h('div', 'chart-legend'), box = h('div', 'chart-box tall');
  card.append(head, box);
  const s = stock.series, chart = makeChart(box, v => fmtPrice(v, m));
  const candles = chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: cssVar('--candle-up'), downColor: cssVar('--candle-down'), wickUpColor: cssVar('--candle-up'), wickDownColor: cssVar('--candle-down'),
    borderVisible: false, priceLineVisible: false,
  });
  candles.setData(s.date.map((time, i) => ({ time, open: s.open[i], high: s.high[i], low: s.low[i], close: s.close[i] })));
  candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
  const vol = chart.addSeries(LightweightCharts.HistogramSeries, { priceScaleId: '', color: cssVar('--vol'), priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
  vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  vol.setData(s.date.map((time, i) => ({ time, value: s.volume[i] })));

  const ink = cssVar('--text'), markers = [];
  for (const t of trades) {
    markers.push({ time: t.buyDate, position: 'belowBar', shape: 'arrowUp', color: ink, text: `매수 ${fmtPrice(t.buyPrice, m)}` });
    if (t.sellDate) markers.push({ time: t.sellDate, position: 'aboveBar', shape: 'arrowDown', color: ink, text: `${MARKER_TEXT[t.reason]} ${fmtPct(t.ret)}` });
  }
  markers.sort((a, b) => a.time.localeCompare(b.time));
  LightweightCharts.createSeriesMarkers(candles, markers);

  // 고른 거래 앞뒤로 확대
  const i0 = s.date.indexOf(focus.buyDate), i1 = focus.sellDate ? s.date.indexOf(focus.sellDate) : s.date.length - 1;
  const pad = Math.max(25, Math.round((i1 - i0) * 0.8));
  chart.timeScale().setVisibleLogicalRange({ from: i0 - pad, to: Math.min(i1 + pad, s.date.length + 5) });

  const items = ['시가', '고가', '저가', '종가'].map(name => ({ name, color: 'transparent', fmt: v => fmtPrice(v, m) }));
  items.push({ name: '거래량', color: 'transparent', fmt: v => fmtNum(v) });
  const show = readout(head, items);
  head.querySelectorAll('.key').forEach(k => k.remove());
  const at = i => show(s.date[i], [s.open[i], s.high[i], s.low[i], s.close[i], s.volume[i]]);
  chart.subscribeCrosshairMove(p => (p.time ? at(s.date.indexOf(timeStr(p.time))) : at(i1)));
  at(i1);
}

// ---------- 공통 조각 ----------
function notes(m, missing) {
  return h('div', 'notes',
    h('p', 'note', 'ℹ️ 관심 종목 안에서만 돌려서 생존 편향이 있어요. 지금까지 살아남은 종목을 골랐기 때문에 실제보다 결과가 좋게 나올 수 있어요. ', infoBtn('survivorship-bias')),
    m === 'kr' ? h('p', 'note', 'ℹ️ 국내 시세는 배당이 빠진 가격 기준이에요 (전략·벤치마크 모두). ', infoBtn('adjusted-price')) : null,
    missing.length ? h('p', 'note warn', `⚠️ 시세 파일이 없는 종목은 빼고 계산했어요: ${missing.join(', ')}`) : null,
  );
}
// 지표 이름 → 📖 용어집 id (지표 카드·비교 표의 ⓘ)
const METRIC_TERMS = {
  '총수익률': 'total-return', 'CAGR (연평균)': 'cagr', 'MDD (최대 낙폭)': 'mdd', '승률': 'win-rate',
  '평균 수익 / 손실': 'payoff-ratio', '평균 수익': 'payoff-ratio', '평균 손실': 'payoff-ratio', '평균 보유일': 'holding-period',
};
const metricInfo = label => (METRIC_TERMS[label] ? infoBtn(METRIC_TERMS[label]) : null);
function tile(label, value, sub, cls = '') {
  return h('div', 'tile', h('div', 'tile-label', label, metricInfo(label)), h('div', `tile-value ${cls}`, value), sub ? h('div', 'tile-sub', sub) : null);
}
const pctCell = v => h('span', tone(v), fmtPct(v));

// ---------- 📊 결과 ----------
let selTrade = null; // 캔들 차트로 보고 있는 거래 { ticker, buyDate }
let runId = 0;
async function renderResults() {
  const m = curMarket(), view = $('resultsView'), list = strategiesOf(m);
  const s = list.find(x => x.id === prefs.sel?.[m]) || list[0];
  const pick = h('select', 'strategy-pick');
  pick.setAttribute('aria-label', '전략');
  for (const x of list) pick.append(Object.assign(h('option', '', x.name), { value: x.id, selected: x === s }));
  pick.addEventListener('change', () => { prefs.sel = { ...prefs.sel, [m]: pick.value }; savePrefs(); selTrade = null; render(); });
  const filters = h('div', 'filters', list.length ? pick : null, periodControl(m));

  const old = view.querySelector('.result-body');
  if (old) old.classList.add('busy'); // 계산하는 동안 이전 화면을 흐리게 유지
  if (!s) return view.replaceChildren(filters, h('p', 'note', '이 시장에는 전략이 없어요. 🧪 전략 탭에서 만들어요.'));
  if (!lastDate(m)) return view.replaceChildren(filters, h('p', 'note', '⏳ 아직 시세 데이터가 없어요. GitHub Actions가 데이터를 받으면 보여요.'));
  if (!old) view.replaceChildren(filters, h('div', 'result-body busy', h('p', 'muted', '계산하는 중…')));

  const id = ++runId;
  const { res, stocks, benchmark, missing } = await backtest(s);
  if (id !== runId || curMarket() !== m || document.body.dataset.tab !== 'results') return; // 그사이 다른 걸 골랐으면 버림
  disposeCharts();

  const x = res.metrics, bm = res.benchMetrics, bname = benchmark?.name || '벤치마크';
  const vsBench = v => (bm ? `${bname} ${fmtPct(v)}` : '');
  const done = res.trades.filter(t => t.reason !== 'open');
  const wins = done.filter(t => t.ret > 0).length;
  const finalValue = res.equity.at(-1) ?? s.money.initial;
  const body = h('div', 'result-body',
    notes(m, missing),
    h('div', 'tiles',
      tile('최종 자산', fmtMoneyShort(finalValue, m), `시작 ${fmtMoneyShort(s.money.initial, m)}`),
      tile('총수익률', fmtPct(x.totalReturn), vsBench(bm?.totalReturn), tone(x.totalReturn)),
      tile('CAGR (연평균)', fmtPct(x.cagr), vsBench(bm?.cagr), tone(x.cagr)),
      tile('MDD (최대 낙폭)', fmtPct(x.mdd), vsBench(bm?.mdd), tone(x.mdd)),
      tile('승률', x.winRate == null ? '–' : `${x.winRate.toFixed(0)}%`, `${wins}승 ${done.length - wins}패`),
      tile('평균 수익 / 손실', h('span', '', pctCell(x.avgWin), ' / ', pctCell(x.avgLoss))),
      tile('거래 횟수', `${x.trades}회`, x.openTrades ? `보유 중 ${x.openTrades}종목` : ''),
      tile('평균 보유일', x.avgHold == null ? '–' : `${x.avgHold.toFixed(1)}일`, '거래일 기준'),
    ),
  );

  // 자산 곡선 vs 벤치마크
  const eqCard = h('section', 'card chart-card', h('h3', '', '📈 자산 곡선', infoBtn('equity-curve'), h('span', 'muted small', ' · 벤치마크(사서 보유)와 비교'), infoBtn('benchmark')));
  body.append(eqCard);
  const lines = [{ name: s.name, short: '전략', color: cssVar(`--s${slotOf(s)}`), data: res.dates.map((time, i) => ({ time, value: res.equity[i] })) }];
  if (res.bench) lines.push({ name: `${bname} (사서 보유)`, short: bname, color: BENCH_COLOR(), data: res.dates.map((time, i) => ({ time, value: res.bench[i] })) });

  // 거래 표 (최근 거래가 위)
  const trades = [...res.trades].reverse();
  const tradeCard = h('section', 'card', h('h3', '', `🧾 거래 목록 · ${res.trades.length}건`));
  const chartCard = h('section', 'card chart-card');
  body.append(tradeCard, chartCard);
  if (!trades.length) tradeCard.append(h('p', 'muted', '이 기간에는 조건을 만족한 날이 없어서 거래가 없어요.'));
  else {
    if (!selTrade || !trades.some(t => t.ticker === selTrade.ticker && t.buyDate === selTrade.buyDate)) selTrade = trades[0];
    const table = h('table', 'grid-table trades');
    table.append(h('thead', '', h('tr', '', ...['종목', '매수일', '매수가', '매도일', '매도가', '수익률', '보유', '사유'].map((t, i) => h('th', i >= 1 && i <= 6 ? 'num' : '', t)))));
    const tbody = h('tbody');
    for (const t of trades) {
      const tr = h('tr', t.ticker === selTrade.ticker && t.buyDate === selTrade.buyDate ? 'on' : '',
        h('td', '', t.name), h('td', 'num', t.buyDate), h('td', 'num', fmtPrice(t.buyPrice, m)),
        h('td', 'num', t.sellDate || '–'), h('td', 'num', fmtPrice(t.sellPrice, m)),
        h('td', 'num', pctCell(t.ret)), h('td', 'num', `${t.holdDays}일`), h('td', '', REASONS[t.reason]));
      tr.tabIndex = 0;
      tr.title = '눌러서 차트로 보기';
      const open = () => { selTrade = t; tbody.querySelector('.on')?.classList.remove('on'); tr.classList.add('on'); drawStock(); chartCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      tbody.append(tr);
    }
    table.append(tbody);
    tradeCard.append(h('div', 'table-wrap scroll', table));
  }

  // 종목 차트: 고른 거래의 종목, 그 종목의 거래를 모두 표시
  let stockChart = null;
  function drawStock() {
    if (stockChart) { stockChart.remove(); liveCharts = liveCharts.filter(c => c !== stockChart); }
    const st = stocks.find(x => x.ticker === selTrade.ticker);
    chartCard.replaceChildren(h('h3', '', `🕯️ ${st.name} `, h('span', 'muted', st.ticker), infoBtn('candlestick')),
      h('p', 'muted small', '▲ 매수 · ▼ 매도 — 표에서 다른 거래를 누르면 그 거래로 옮겨요. 빨강 = 오른 날, 파랑 = 내린 날.'));
    candleChart(chartCard, m, st, res.trades.filter(t => t.ticker === st.ticker), selTrade);
    stockChart = liveCharts.at(-1);
  }

  view.replaceChildren(filters, body);
  lineChart(eqCard, lines, v => fmtMoney(v, m), v => fmtMoneyShort(v, m));
  if (trades.length) drawStock(); else chartCard.remove();
}

// ---------- ⚖️ 비교 ----------
const MAX_COMPARE = STRATEGY_SLOTS.length;
async function renderCompare() {
  const m = curMarket(), view = $('compareView'), list = strategiesOf(m);
  const saved = prefs.cmp?.[m];
  const chosen = list.filter(s => (saved ? saved.includes(s.id) : true)).slice(0, MAX_COMPARE);
  // 같은 색 슬롯이 겹치면(전략이 7개 넘을 때만) 빈 슬롯으로 비켜 줌
  const used = new Set(), slot = new Map();
  for (const s of chosen) { let k = slotOf(s); if (used.has(k)) k = STRATEGY_SLOTS.find(x => !used.has(x)); used.add(k); slot.set(s, k); }

  const picks = h('div', 'picks');
  for (const s of list) {
    const box = Object.assign(h('input'), { type: 'checkbox', checked: chosen.includes(s) });
    box.disabled = !box.checked && chosen.length >= MAX_COMPARE;
    box.addEventListener('change', () => {
      const ids = new Set(chosen.map(x => x.id));
      box.checked ? ids.add(s.id) : ids.delete(s.id);
      prefs.cmp = { ...prefs.cmp, [m]: [...ids] };
      savePrefs();
      render();
    });
    const key = h('i', 'key');
    if (chosen.includes(s)) key.style.background = cssVar(`--s${slot.get(s)}`);
    picks.append(h('label', 'pick', box, key, s.name));
  }
  const filters = h('div', 'filters', periodControl(m));
  const old = view.querySelector('.result-body');
  if (old) old.classList.add('busy');
  const head = [filters, h('p', 'muted', `비교할 전략을 고르세요 (최대 ${MAX_COMPARE}개). 시작 자본이 달라도 같은 눈금으로 보게 수익률(%)로 그려요.`), picks];
  if (!lastDate(m)) return view.replaceChildren(...head, h('p', 'note', '⏳ 아직 시세 데이터가 없어요.'));
  if (!chosen.length) return view.replaceChildren(...head);
  if (!old) view.replaceChildren(...head, h('div', 'result-body busy', h('p', 'muted', '계산하는 중…')));

  const id = ++runId;
  const runs = await Promise.all(chosen.map(backtest));
  if (id !== runId || curMarket() !== m || document.body.dataset.tab !== 'compare') return;
  disposeCharts();

  const first = runs[0], bname = first.benchmark?.name || '벤치마크';
  const cols = chosen.map((s, i) => ({ name: s.name, color: cssVar(`--s${slot.get(s)}`), r: runs[i].res, initial: s.money.initial }));
  const table = h('table', 'grid-table compare');
  const th = (c, color) => { const e = h('th', 'num', h('i', 'key'), c); e.firstChild.style.background = color; return e; };
  table.append(h('thead', '', h('tr', '', h('th', '', '지표'), ...cols.map(c => th(c.name, c.color)), first.res.bench ? th(`${bname} (사서 보유)`, BENCH_COLOR()) : null)));
  const ROWS = [
    ['총수익률', r => pctCell(r.metrics.totalReturn), b => pctCell(b.totalReturn)],
    ['CAGR (연평균)', r => pctCell(r.metrics.cagr), b => pctCell(b.cagr)],
    ['MDD (최대 낙폭)', r => pctCell(r.metrics.mdd), b => pctCell(b.mdd)],
    ['승률', r => (r.metrics.winRate == null ? '–' : `${r.metrics.winRate.toFixed(0)}%`)],
    ['평균 수익', r => pctCell(r.metrics.avgWin)],
    ['평균 손실', r => pctCell(r.metrics.avgLoss)],
    ['거래 횟수', r => `${r.metrics.trades}회`],
    ['평균 보유일', r => (r.metrics.avgHold == null ? '–' : `${r.metrics.avgHold.toFixed(1)}일`)],
  ];
  const tbody = h('tbody');
  for (const [label, cell, bcell] of ROWS) {
    tbody.append(h('tr', '', h('td', '', label, metricInfo(label)), ...cols.map(c => h('td', 'num', cell(c.r))),
      first.res.bench ? h('td', 'num', bcell ? bcell(first.res.benchMetrics) : '–') : null));
  }
  table.append(tbody);

  const chartCard = h('section', 'card chart-card', h('h3', '', '📈 누적 수익률'));
  view.replaceChildren(...head, h('div', 'result-body', notes(m, first.missing), h('div', 'card table-wrap', table), chartCard));
  const pct = (curve, initial) => curve.map((v, i) => ({ time: first.res.dates[i], value: (v / initial - 1) * 100 }));
  const lines = cols.map(c => ({ name: c.name, color: c.color, data: pct(c.r.equity, c.initial) }));
  if (first.res.bench) lines.push({ name: `${bname} (사서 보유)`, short: bname, color: BENCH_COLOR(), data: pct(first.res.bench, first.res.bench[0]) });
  lineChart(chartCard, lines, v => fmtPct(v));
}
