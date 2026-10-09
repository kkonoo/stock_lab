'use strict';
// 백테스트 엔진: 지표 계산, 매수 조건, 체결, 성과 지표. 화면(DOM)은 건드리지 않음 → test.html에서 따로 시험
// 가격 = { date: ['YYYY-MM-DD'], open: [], high: [], low: [], close: [], volume: [] } (날짜 오름차순, 같은 길이)
// 퍼센트 값은 모두 % 단위 (10 = 10%)

const Engine = (() => {
  // data/prices/*.json의 rows → 가격 배열
  function fromRows(rows) {
    const s = { date: [], open: [], high: [], low: [], close: [], volume: [] };
    for (const [d, o, h, l, c, v] of rows) {
      s.date.push(d); s.open.push(o); s.high.push(h); s.low.push(l); s.close.push(c); s.volume.push(v);
    }
    return s;
  }

  // ---------- 지표: 입력과 같은 길이, 데이터가 모자란 앞부분은 NaN ----------
  // 단순 이동평균: 오늘 포함 n일
  function sma(values, n) {
    const out = new Array(values.length).fill(NaN);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= n) sum -= values[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  // RSI (Wilder 방식): 첫 평균은 n일 단순평균, 그다음은 (이전 평균×(n−1) + 오늘) / n
  function rsi(close, n) {
    const out = new Array(close.length).fill(NaN);
    let gain = 0, loss = 0;
    for (let i = 1; i < close.length; i++) {
      const ch = close[i] - close[i - 1];
      const g = Math.max(ch, 0), l = Math.max(-ch, 0);
      if (i <= n) { gain += g / n; loss += l / n; } else { gain = (gain * (n - 1) + g) / n; loss = (loss * (n - 1) + l) / n; }
      if (i >= n) out[i] = loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
    }
    return out;
  }

  // n일 수익률(%): 오늘 종가 / n일 전 종가 − 1
  const returnPct = (close, n) => close.map((c, i) => (i >= n ? (c / close[i - n] - 1) * 100 : NaN));

  // 오늘을 뺀 직전 n일 평균 (거래량 비교용)
  const prevAvg = (values, n) => sma(values, n).map((_, i, a) => (i >= 1 ? a[i - 1] : NaN));

  // 오늘 포함 n일 중 최고값
  function highest(values, n) {
    const out = new Array(values.length).fill(NaN);
    for (let i = n - 1; i < values.length; i++) {
      let m = -Infinity;
      for (let k = i - n + 1; k <= i; k++) if (values[k] > m) m = values[k];
      out[i] = m;
    }
    return out;
  }

  // ---------- 매수 조건: t일 종가까지의 데이터만 보고 참/거짓 (NaN과 비교하면 거짓 → 데이터 모자라면 거짓) ----------
  const YEAR_BARS = 252; // 52주 ≈ 252거래일
  const CONDITIONS = {
    // 종가가 n일 이동평균 위/아래
    priceVsMa: (s, c) => {
      const ma = sma(s.close, c.n);
      return s.close.map((x, i) => (c.op === 'below' ? x < ma[i] : x > ma[i]));
    },
    // 단기(short) 이동평균이 장기(long)를 오늘 뚫고 올라감(golden) / 내려감(dead)
    maCross: (s, c) => {
      const a = sma(s.close, c.short), b = sma(s.close, c.long);
      return s.close.map((_, i) => i >= 1 && (c.dir === 'dead'
        ? a[i - 1] >= b[i - 1] && a[i] < b[i]
        : a[i - 1] <= b[i - 1] && a[i] > b[i]));
    },
    // RSI(n) 이상/이하
    rsi: (s, c) => rsi(s.close, c.n).map(r => (c.op === 'lte' ? r <= c.value : r >= c.value)),
    // 최근 n일 수익률(%) 이상/이하
    return: (s, c) => returnPct(s.close, c.n).map(r => (c.op === 'lte' ? r <= c.value : r >= c.value)),
    // 거래량이 직전 n일 평균의 k배 이상
    volume: (s, c) => {
      const avg = prevAvg(s.volume, c.n);
      return s.volume.map((v, i) => avg[i] > 0 && v >= c.k * avg[i]);
    },
    // 종가가 52주(252거래일) 최고가 대비 pct% 이내
    nearHigh: (s, c) => {
      const hi = highest(s.high, YEAR_BARS);
      return s.close.map((x, i) => x >= hi[i] * (1 - c.pct / 100));
    },
  };

  // 모든 조건을 만족(AND)하는 날 = 신호. 조건이 없으면 신호 없음
  function signals(s, conditions) {
    if (!conditions.length) return s.close.map(() => false);
    const each = conditions.map(c => CONDITIONS[c.type](s, c));
    return s.close.map((_, i) => each.every(e => e[i]));
  }

  // ---------- 매도 판단 (보유 종목의 j번째 봉) ----------
  function exitCheck(pos, s, j, exit) {
    const o = s.open[j];
    if (j !== pos.entryIdx) { // 갭: 시가가 이미 손절가·익절가를 넘어서 시작하면 시가에 체결 (매수한 날은 시가 = 매수가라 해당 없음)
      if (pos.sl != null && o <= pos.sl) return { price: o, reason: 'sl' };
      if (pos.tp != null && o >= pos.tp) return { price: o, reason: 'tp' };
    }
    // 일봉으론 순서를 모르니, 같은 날 저가가 손절가·고가가 익절가에 둘 다 닿으면 손절이 먼저 (보수적)
    if (pos.sl != null && s.low[j] <= pos.sl) return { price: pos.sl, reason: 'sl' };
    if (pos.tp != null && s.high[j] >= pos.tp) return { price: pos.tp, reason: 'tp' };
    if (exit.maxHoldDays > 0 && j - pos.entryIdx + 1 >= exit.maxHoldDays) return { price: s.close[j], reason: 'time' };
    return null;
  }

  // ---------- 백테스트 ----------
  // stocks: [{ ticker, name, series }] — 같은 날 신호가 빈 자리보다 많으면 이 순서대로 채움
  // benchmark: { ticker, name, series } | null
  // strategy: { entry: [조건], exit: { takeProfit, stopLoss, maxHoldDays }, money: { initial, sizing: 'fixed'|'percent', amount, percent, maxPositions } }
  // costs: { buyFee, sellFee, sellTax, slippage } (%)   from/to: 'YYYY-MM-DD' (없으면 전체)
  function run({ stocks, benchmark = null, strategy, costs, from = '', to = '9999-12-31' }) {
    const { entry, exit, money } = strategy;
    const buyFee = costs.buyFee / 100, sellCost = (costs.sellFee + costs.sellTax) / 100, slip = costs.slippage / 100;
    const on = v => v != null && v > 0;
    const S = stocks.map(st => ({ ...st, sig: signals(st.series, entry), p: -1 })); // p = 오늘까지 지난 마지막 봉
    const dates = [...new Set(S.flatMap(st => st.series.date.filter(d => d >= from && d <= to)))].sort();

    let cash = money.initial;
    const positions = [], trades = [], equity = [];
    const closeTrade = (pos, date, price, reason, j) => {
      const proceeds = pos.shares * price * (1 - sellCost);
      trades.push({
        ticker: pos.st.ticker, name: pos.st.name, shares: pos.shares,
        buyDate: pos.buyDate, buyPrice: pos.fill, sellDate: date, sellPrice: price,
        ret: (proceeds / pos.cost - 1) * 100, pnl: proceeds - pos.cost, reason, holdDays: j - pos.entryIdx + 1,
      });
      return proceeds;
    };

    for (const D of dates) {
      for (const st of S) while (st.p + 1 < st.series.date.length && st.series.date[st.p + 1] <= D) st.p++;
      const prevEquity = equity.length ? equity[equity.length - 1] : money.initial;

      // 1) 매수: 전날(t) 종가 신호 → 오늘(t+1) 시가. 현금·빈 자리는 어제 장 마감 기준 (오늘 판 돈은 내일부터)
      let slots = money.maxPositions - positions.length;
      for (const st of S) {
        if (slots <= 0) break;
        const s = st.series, j = st.p;
        if (j < 1 || s.date[j] !== D || !st.sig[j - 1] || s.date[j - 1] < from) continue;
        if (positions.some(x => x.st === st)) continue; // 같은 종목 중복 매수 금지
        const fill = s.open[j] * (1 + slip);
        const budget = money.sizing === 'percent' ? prevEquity * money.percent / 100 : money.amount;
        const shares = Math.floor(budget / (fill * (1 + buyFee)));
        const cost = shares * fill * (1 + buyFee);
        if (shares < 1 || cost > cash) continue; // 정수 주만, 현금 모자라면 건너뜀
        cash -= cost; slots--;
        positions.push({
          st, shares, cost, fill, entryIdx: j, buyDate: D,
          tp: on(exit.takeProfit) ? fill * (1 + exit.takeProfit / 100) : null, // 익절·손절 기준 = 실제 매수 체결가
          sl: on(exit.stopLoss) ? fill * (1 - exit.stopLoss / 100) : null,
        });
      }

      // 2) 매도: 오늘 봉이 있는 보유 종목 (오늘 산 종목도 그날 고가·저가로 바로 팔릴 수 있음)
      for (const pos of [...positions]) {
        const s = pos.st.series, j = pos.st.p;
        if (s.date[j] !== D) continue;
        const hit = exitCheck(pos, s, j, exit);
        if (!hit) continue;
        cash += closeTrade(pos, D, hit.price * (1 - slip), hit.reason, j);
        positions.splice(positions.indexOf(pos), 1);
      }

      // 3) 오늘 종가로 평가 (오늘 봉이 없는 종목은 마지막 종가)
      equity.push(cash + positions.reduce((v, pos) => v + pos.shares * pos.st.series.close[pos.st.p], 0));
    }

    // 끝날 때 보유 중: 마지막 종가로 평가만 (승률·거래 횟수에서 빠짐)
    for (const pos of positions) {
      const s = pos.st.series, j = pos.st.p;
      trades.push({
        ticker: pos.st.ticker, name: pos.st.name, shares: pos.shares,
        buyDate: pos.buyDate, buyPrice: pos.fill, sellDate: null, sellPrice: s.close[j],
        ret: (pos.shares * s.close[j] / pos.cost - 1) * 100, pnl: pos.shares * s.close[j] - pos.cost, reason: 'open', holdDays: j - pos.entryIdx + 1,
      });
    }
    trades.sort((a, b) => a.buyDate.localeCompare(b.buyDate) || stocks.findIndex(x => x.ticker === a.ticker) - stocks.findIndex(x => x.ticker === b.ticker));

    const bench = benchmark ? benchCurve(benchmark.series, dates, money.initial) : null;
    return {
      dates, equity, trades, bench,
      metrics: { ...curveMetrics(dates, equity, money.initial), ...tradeMetrics(trades) },
      benchMetrics: bench ? curveMetrics(dates, bench, money.initial) : null,
    };
  }

  // 벤치마크 buy & hold: 첫날 종가에 전부 사서 보유, 비용 없음 (그날 데이터가 없으면 가장 가까운 종가)
  function benchCurve(s, dates, initial) {
    let p = -1, base = null;
    return dates.map(D => {
      while (p + 1 < s.date.length && s.date[p + 1] <= D) p++;
      if (base == null) base = s.close[Math.max(p, 0)];
      return p < 0 ? initial : initial * s.close[p] / base;
    });
  }

  // ---------- 성과 지표 ----------
  // 총수익률·CAGR·MDD(%) — MDD는 음수 (−25 = 고점 대비 최대 25% 하락)
  function curveMetrics(dates, curve, initial) {
    if (!curve.length) return { totalReturn: 0, cagr: null, mdd: 0 };
    const last = curve[curve.length - 1];
    const years = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / (365.25 * 86400000);
    let peak = -Infinity, mdd = 0;
    for (const v of curve) {
      peak = Math.max(peak, v);
      mdd = Math.min(mdd, (v / peak - 1) * 100);
    }
    return {
      totalReturn: (last / initial - 1) * 100,
      cagr: years > 0 && last > 0 ? (Math.pow(last / initial, 1 / years) - 1) * 100 : null,
      mdd,
    };
  }

  // 승률·평균 수익·평균 손실(%)·거래 횟수·평균 보유일 — 끝난 거래만
  function tradeMetrics(trades) {
    const done = trades.filter(t => t.reason !== 'open');
    const wins = done.filter(t => t.ret > 0), losses = done.filter(t => t.ret <= 0);
    const avg = (arr, f) => (arr.length ? arr.reduce((a, t) => a + f(t), 0) / arr.length : null);
    return {
      trades: done.length,
      openTrades: trades.length - done.length,
      winRate: done.length ? wins.length / done.length * 100 : null,
      avgWin: avg(wins, t => t.ret),
      avgLoss: avg(losses, t => t.ret),
      avgHold: avg(done, t => t.holdDays),
    };
  }

  return { fromRows, sma, rsi, returnPct, prevAvg, highest, CONDITIONS, signals, run, curveMetrics, tradeMetrics };
})();
