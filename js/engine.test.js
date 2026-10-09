'use strict';
// 엔진 단위 테스트 (합성 데이터). test.html이 TESTS를 차례로 돌려서 결과를 보여 줌

const TESTS = [];
const test = (name, fn) => TESTS.push({ name, fn });

// ---------- 확인 도구 ----------
const fmt = v => (Array.isArray(v) ? `[${v.map(fmt).join(', ')}]` : typeof v === 'number' ? String(+v.toFixed(6)) : JSON.stringify(v));
function same(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: 기대 ${fmt(expected)}, 실제 ${fmt(actual)}`);
}
function near(actual, expected, what, eps = 1e-9) {
  const bothNaN = Number.isNaN(actual) && Number.isNaN(expected);
  if (!bothNaN && !(Math.abs(actual - expected) <= eps * Math.max(1, Math.abs(expected)))) throw new Error(`${what}: 기대 ${fmt(expected)}, 실제 ${fmt(actual)}`);
}
function nearAll(actual, expected, what, eps) {
  same(actual.length, expected.length, `${what} 길이`);
  expected.forEach((e, i) => near(actual[i], e, `${what}[${i}]`, eps));
}
function ok(cond, what) { if (!cond) throw new Error(what); }

// ---------- 합성 데이터 ----------
// 2024-01-01(월)부터 평일 날짜를 붙여 가격 배열을 만듦. 행은 [시가, 고가, 저가, 종가] 또는 숫자 하나(네 값 모두 같음)
function mk(rows, volume = 1000) {
  const out = [];
  let t = Date.UTC(2024, 0, 1);
  for (const r of rows) {
    while ([0, 6].includes(new Date(t).getUTCDay())) t += 86400000;
    const [o, h, l, c] = typeof r === 'number' ? [r, r, r, r] : r;
    out.push([new Date(t).toISOString().slice(0, 10), o, h, l, c, volume]);
    t += 86400000;
  }
  return Engine.fromRows(out);
}

// 매수 신호: 전날보다 5% 이상 오른 날. UP의 마지막 날(3번째, 0부터) 종가가 +6% → 그날 신호 → 4번째 날 시가에 매수
const TRIGGER = [{ type: 'return', n: 1, op: 'gte', value: 5 }];
const UP = [100, 100, 100, [100, 106, 100, 106]];
const FLAT = [100, 101, 99, 100]; // 익절·손절 어디에도 안 닿는 날
const NO_COST = { buyFee: 0, sellFee: 0, sellTax: 0, slippage: 0 };
const strategy = (exit = {}, money = {}) => ({
  entry: TRIGGER,
  exit: { takeProfit: 10, stopLoss: 5, maxHoldDays: 0, ...exit },
  money: { initial: 1000000, sizing: 'fixed', amount: 100000, percent: 10, maxPositions: 5, ...money },
});
const runOne = (series, exit, money, costs = NO_COST) =>
  Engine.run({ stocks: [{ ticker: 'A', name: '가', series }], strategy: strategy(exit, money), costs });

// ---------- 지표 ----------
test('이동평균(MA): [1,2,3,4,5]의 3일 평균 = -, -, 2, 3, 4', () => {
  nearAll(Engine.sma([1, 2, 3, 4, 5], 3), [NaN, NaN, 2, 3, 4], 'MA3');
});

test('RSI(3) Wilder 방식: 손으로 계산한 값 80 → 84.615… → 50', () => {
  // 종가 10, 11, 10.5, 11.5, 12, 11 → 변화 +1, −0.5, +1, +0.5, −1
  // 3번째: 평균상승 (1+0+1)/3 = 2/3, 평균하락 0.5/3 = 1/6 → RS 4 → RSI 100 − 100/5 = 80
  // 4번째: 상승 (2/3×2 + 0.5)/3 = 11/18, 하락 (1/6×2 + 0)/3 = 1/9 → RS 5.5 → RSI 100 − 100/6.5 = 84.615…
  // 5번째: 상승 (11/18×2 + 0)/3 = 11/27, 하락 (1/9×2 + 1)/3 = 11/27 → RS 1 → RSI 50
  nearAll(Engine.rsi([10, 11, 10.5, 11.5, 12, 11], 3), [NaN, NaN, NaN, 80, 100 - 100 / 6.5, 50], 'RSI3');
});

test('RSI: 계속 오르기만 하면 100', () => {
  nearAll(Engine.rsi([1, 2, 3, 4, 5], 2).slice(2), [100, 100, 100], 'RSI2');
});

test('n일 수익률: 100 → 110 → 99 의 1일·2일 수익률', () => {
  nearAll(Engine.returnPct([100, 110, 99], 1), [NaN, 10, -10], '1일');
  nearAll(Engine.returnPct([100, 110, 99], 2), [NaN, NaN, -1], '2일');
});

// ---------- 매수 조건 ----------
const cond = (series, c) => Engine.signals(series, [c]);

test('종가 vs 이동평균: 위/아래', () => {
  const s = mk([10, 10, 10, 13, 7]); // MA3: -, -, 10, 11, 10
  same(cond(s, { type: 'priceVsMa', n: 3, op: 'above' }).join(), 'false,false,false,true,false', '위');
  same(cond(s, { type: 'priceVsMa', n: 3, op: 'below' }).join(), 'false,false,false,false,true', '아래');
});

test('골든크로스·데드크로스(2일/4일): 손으로 찾은 날짜', () => {
  // 종가 10,10,10,10,8,8,10,13,14 → MA2: -,10,10,10,9,8,9,11.5,13.5 / MA4: -,-,-,10,9.5,9,9,9.75,11.25
  // 4번째: MA2 10→9 가 MA4 10→9.5 아래로 → 데드 / 7번째: MA2 9→11.5 가 MA4 9→9.75 위로 → 골든
  const s = mk([10, 10, 10, 10, 8, 8, 10, 13, 14]);
  const at = arr => arr.flatMap((v, i) => (v ? [i] : [])).join();
  same(at(cond(s, { type: 'maCross', short: 2, long: 4, dir: 'golden' })), '7', '골든크로스');
  same(at(cond(s, { type: 'maCross', short: 2, long: 4, dir: 'dead' })), '4', '데드크로스');
});

test('RSI 조건: 이상/이하', () => {
  const s = mk([10, 11, 10.5, 11.5, 12, 11]); // RSI3: -, -, -, 80, 84.6, 50
  same(cond(s, { type: 'rsi', n: 3, op: 'gte', value: 80 }).join(), 'false,false,false,true,true,false', '80 이상');
  same(cond(s, { type: 'rsi', n: 3, op: 'lte', value: 55 }).join(), 'false,false,false,false,false,true', '55 이하');
});

test('거래량: 오늘 빼고 직전 n일 평균의 k배 이상', () => {
  const s = mk([1, 1, 1, 1, 1]);
  s.volume = [10, 20, 30, 40, 100];
  // 직전 2일 평균: -, -, 15, 25, 35 → 2배: 30≥30 ✔, 40≥50 ✘, 100≥70 ✔
  nearAll(Engine.prevAvg(s.volume, 2), [NaN, NaN, 15, 25, 35], '직전 2일 평균');
  same(cond(s, { type: 'volume', n: 2, k: 2 }).join(), 'false,false,true,false,true', '2배 이상');
});

test('52주 신고가 대비 x% 이내: 252거래일 안의 최고가 기준, 모자라면 거짓', () => {
  const rows = new Array(300).fill(100);
  rows[100] = [100, 120, 100, 100]; // 100번째 날 고가 120
  const s = mk(rows);
  const w20 = cond(s, { type: 'nearHigh', pct: 20 }), w10 = cond(s, { type: 'nearHigh', pct: 10 });
  same(w20[250], false, '251일째(데이터 모자람)');
  same(w20[260], true, '종가 100 ≥ 120×0.8');
  same(w10[260], false, '종가 100 < 120×0.9');
});

test('신호 계산은 미래 데이터를 쓰지 않음 (뒤를 잘라도 그날 신호가 같음)', () => {
  let x = 7;
  const rand = () => (x = (x * 16807) % 2147483647) / 2147483647;
  let c = 100;
  const rows = [];
  for (let i = 0; i < 300; i++) {
    const o = c * (1 + (rand() - 0.5) * 0.04);
    c = o * (1 + (rand() - 0.47) * 0.06); // 살짝 오르는 쪽으로 기울여서 52주 신고가 근처도 나오게
    rows.push([o, Math.max(o, c) * (1 + rand() * 0.02), Math.min(o, c) * (1 - rand() * 0.02), c]);
  }
  const full = mk(rows);
  full.volume = full.volume.map(() => Math.round(1000 + rand() * 3000));
  const conds = [
    { type: 'priceVsMa', n: 5, op: 'above' }, { type: 'maCross', short: 3, long: 8, dir: 'golden' },
    { type: 'rsi', n: 5, op: 'gte', value: 55 }, { type: 'return', n: 3, op: 'gte', value: 1 },
    { type: 'volume', n: 5, k: 1.3 }, { type: 'nearHigh', pct: 10 },
  ];
  for (const c of conds) {
    const all = cond(full, c);
    ok(all.some(Boolean) && !all.every(Boolean), `${c.type}: 신호가 참·거짓 둘 다 나와야 시험이 됨`);
    for (let i = 0; i < 300; i += 7) {
      const cut = Object.fromEntries(Object.entries(full).map(([k, v]) => [k, v.slice(0, i + 1)]));
      same(cond(cut, c)[i], all[i], `${c.type} ${i}번째 날`);
    }
  }
});

test('조건 여러 개는 AND, 조건이 없으면 신호 없음', () => {
  const s = mk([10, 10, 10, 13, 7]);
  const both = Engine.signals(s, [{ type: 'priceVsMa', n: 3, op: 'above' }, { type: 'return', n: 1, op: 'gte', value: 50 }]);
  same(both.join(), 'false,false,false,false,false', 'MA 위 AND +50%');
  same(Engine.signals(s, []).some(Boolean), false, '조건 없음');
});

// ---------- 체결 ----------
test('신호 다음 날 시가에 매수 (신호 난 날 종가·다음 날 종가가 아님)', () => {
  const s = mk([...UP, [102, 103, 101, 101], 101, 101]);
  const t = runOne(s).trades;
  same(t.length, 1, '거래 수');
  same(t[0].buyDate, s.date[4], '매수일 = 신호 다음 날');
  same(t[0].buyPrice, 102, '매수가 = 다음 날 시가');
});

test('익절가 도달 → 익절가에 매도', () => {
  const s = mk([...UP, FLAT, [102, 111, 101, 105], 100]);
  const t = runOne(s).trades[0];
  same(t.reason, 'tp', '사유');
  same(t.sellDate, s.date[5], '매도일');
  near(t.sellPrice, 110, '매도가 = 100 × 1.10');
  near(t.ret, 10, '수익률');
});

test('손절가 도달 → 손절가에 매도', () => {
  const s = mk([...UP, FLAT, [99, 101, 94, 96], 100]);
  const t = runOne(s).trades[0];
  same(t.reason, 'sl', '사유');
  near(t.sellPrice, 95, '매도가 = 100 × 0.95');
  near(t.ret, -5, '수익률');
});

test('같은 날 고가가 익절가·저가가 손절가에 둘 다 닿으면 → 손절', () => {
  const t = runOne(mk([...UP, FLAT, [100, 111, 94, 105], 100])).trades[0];
  same(t.reason, 'sl', '사유');
  near(t.sellPrice, 95, '매도가');
});

test('갭 하락으로 시가가 손절가 아래 → 시가에 매도', () => {
  const t = runOne(mk([...UP, FLAT, [90, 92, 88, 91], 100])).trades[0];
  same(t.reason, 'sl', '사유');
  near(t.sellPrice, 90, '매도가 = 시가 (손절가 95보다 나쁨)');
  near(t.ret, -10, '수익률');
});

test('갭 상승으로 시가가 익절가 위 → 시가에 매도', () => {
  const t = runOne(mk([...UP, FLAT, [115, 118, 113, 116], 100])).trades[0];
  same(t.reason, 'tp', '사유');
  near(t.sellPrice, 115, '매도가 = 시가');
});

test('매수한 날에도 저가가 손절가에 닿으면 그날 손절', () => {
  const s = mk([...UP, [100, 101, 94, 96], 100]);
  const t = runOne(s).trades[0];
  same(t.sellDate, s.date[4], '매도일 = 매수일');
  same(t.reason, 'sl', '사유');
  same(t.holdDays, 1, '보유일');
});

test('최대 보유일 3일 → 3일째 종가에 기간만료 매도', () => {
  const s = mk([...UP, FLAT, FLAT, [100, 101, 99, 100.5], FLAT]);
  const t = runOne(s, { maxHoldDays: 3 }).trades[0];
  same(t.reason, 'time', '사유');
  same(t.sellDate, s.date[6], '매도일 = 매수일 포함 3일째');
  near(t.sellPrice, 100.5, '매도가 = 그날 종가');
  same(t.holdDays, 3, '보유일');
});

test('마지막 날에 신호가 나면 거래하지 않음', () => {
  same(runOne(mk(UP)).trades.length, 0, '거래 수');
});

test('끝날 때 보유 중이면 마지막 종가로 평가, 거래 횟수에선 빠짐', () => {
  const r = runOne(mk([...UP, FLAT, [100, 101, 99, 104]]));
  same(r.trades[0].reason, 'open', '사유');
  near(r.trades[0].sellPrice, 104, '평가가 = 마지막 종가');
  same(r.metrics.trades, 0, '거래 횟수');
  same(r.metrics.openTrades, 1, '보유 중');
  near(r.equity[r.equity.length - 1], 1000000 + 1000 * 4, '자산 = 현금 + 1000주 × 104');
});

test('수수료·세금·슬리피지가 체결가와 수익률에 반영됨', () => {
  const costs = { buyFee: 0.1, sellFee: 0.2, sellTax: 0.3, slippage: 0.5 };
  const s = mk([...UP, FLAT, [102, 120, 101, 104], 100]);
  const r = runOne(s, {}, {}, costs);
  const t = r.trades[0];
  // 매수 체결가 = 시가 100 × 1.005 = 100.5 → 1주 비용 100.5 × 1.001 = 100.6005 → 10만 원으로 994주
  near(t.buyPrice, 100.5, '매수 체결가');
  same(t.shares, 994, '주식 수');
  // 익절가 = 100.5 × 1.1 = 110.55 → 매도 체결가 110.55 × 0.995 = 109.99725, 1주 받는 돈 109.99725 × (1 − 0.002 − 0.003)
  near(t.sellPrice, 109.99725, '매도 체결가');
  near(t.ret, (109.99725 * 0.995 / 100.6005 - 1) * 100, '수익률');
  ok(t.ret < 10 && t.ret > 8.7, `비용 없을 때(10%)보다 낮아야 함: ${t.ret}`);
  near(r.equity[r.equity.length - 1], 1000000 - 994 * 100.6005 + 994 * 109.99725 * 0.995, '최종 자산', 1e-12);
});

test('최대 동시 보유 수를 넘는 신호는 무시 (목록 순서대로 채움)', () => {
  const s = mk([...UP, FLAT, FLAT, FLAT]);
  const stocks = ['A', 'B', 'C'].map(ticker => ({ ticker, name: ticker, series: s }));
  const r = Engine.run({ stocks, strategy: strategy({}, { maxPositions: 2 }), costs: NO_COST });
  same(r.trades.map(t => t.ticker).join(), 'A,B', '산 종목');
});

test('판 날 빈 자리는 다음 날부터 (같은 날 시가 매수에는 못 씀)', () => {
  // A: 3번째 날 신호 → 4번째 날 매수 → 5번째 날 익절 / B: 4번째 날 신호 → 5번째 날 시가에 사려 하지만 자리가 아직 없음
  const a = mk([...UP, FLAT, [102, 111, 101, 104], 100]);
  const b = mk([100, 100, 100, 100, [100, 106, 100, 106], 106, 106]);
  const stocks = [{ ticker: 'A', name: 'A', series: a }, { ticker: 'B', name: 'B', series: b }];
  const r = Engine.run({ stocks, strategy: strategy({}, { maxPositions: 1 }), costs: NO_COST });
  same(r.trades.map(t => t.ticker).join(), 'A', '산 종목');
});

test('같은 종목 중복 매수 금지', () => {
  const s = mk([...UP, FLAT, [100, 107, 100, 107], 107, 107]); // 보유 중 5번째 날 또 +7% 신호
  same(runOne(s, { takeProfit: 50, stopLoss: 50 }).trades.length, 1, '거래 수');
});

test('1회 매수 금액: 자본 대비 % = 전날 총자산 기준', () => {
  const t = runOne(mk([...UP, FLAT, 100]), {}, { sizing: 'percent', percent: 50 }).trades[0];
  same(t.shares, 5000, '100만 원의 50% ÷ 100원');
});

test('현금이 모자라면 그 신호는 건너뜀', () => {
  same(runOne(mk([...UP, FLAT, 100]), {}, { initial: 50000 }).trades.length, 0, '거래 수 (10만 원어치 살 현금 없음)');
});

test('기간(from~to): 기간 밖 신호로는 사지 않음', () => {
  const s = mk([...UP, FLAT, FLAT]);
  same(Engine.run({ stocks: [{ ticker: 'A', name: 'A', series: s }], strategy: strategy(), costs: NO_COST, from: s.date[4] }).trades.length, 0, '신호일이 시작일 전');
  same(Engine.run({ stocks: [{ ticker: 'A', name: 'A', series: s }], strategy: strategy(), costs: NO_COST, to: s.date[3] }).trades.length, 0, '매수일이 종료일 뒤');
});

// ---------- 성과 지표 ----------
test('총수익률·MDD·CAGR', () => {
  const m = Engine.curveMetrics(['2020-01-01', '2020-06-01', '2021-01-01', '2022-01-01'], [100, 120, 90, 121], 100);
  near(m.totalReturn, 21, '총수익률');
  near(m.mdd, -25, 'MDD = 120 → 90');
  near(m.cagr, 10, 'CAGR: 2년에 21% ≈ 연 10%', 1e-3);
});

test('승률·평균 수익·평균 손실·평균 보유일 (보유 중은 제외)', () => {
  const tr = (ret, holdDays, reason = 'tp') => ({ ret, holdDays, reason });
  const m = Engine.tradeMetrics([tr(10, 2), tr(-5, 4, 'sl'), tr(20, 6), tr(-2, 8, 'time'), tr(50, 1, 'open')]);
  same(m.trades, 4, '거래 횟수');
  same(m.openTrades, 1, '보유 중');
  near(m.winRate, 50, '승률');
  near(m.avgWin, 15, '평균 수익');
  near(m.avgLoss, -3.5, '평균 손실');
  near(m.avgHold, 5, '평균 보유일');
});

test('벤치마크 buy & hold: 첫날 종가에 전부 사서 보유', () => {
  const s = mk([...UP, FLAT, 100]);
  const bench = mk([50, 55, 45, 60, 50, 75]);
  const r = Engine.run({ stocks: [{ ticker: 'A', name: 'A', series: s }], benchmark: { ticker: 'B', series: bench }, strategy: strategy(), costs: NO_COST });
  nearAll(r.bench, [1, 1.1, 0.9, 1.2, 1, 1.5].map(x => x * 1000000), '벤치마크 자산');
  near(r.benchMetrics.mdd, (0.9 / 1.1 - 1) * 100, '벤치마크 MDD');
});
