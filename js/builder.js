'use strict';
// 🧪 전략 탭: 전략 목록과 쉬운 말 설명

// 매수 조건 종류 (계산은 engine.js의 Engine.CONDITIONS)
const CONDS = {
  priceVsMa: { label: '종가 vs 이동평균', text: c => `종가가 ${c.n}일 이동평균 ${c.op === 'below' ? '아래' : '위'}` },
  maCross: { label: '이동평균 크로스', text: c => `${c.short}일선이 ${c.long}일선을 ${c.dir === 'dead' ? '뚫고 내려감 (데드크로스)' : '뚫고 올라감 (골든크로스)'}` },
  rsi: { label: 'RSI', text: c => `RSI(${c.n})가 ${c.value} ${c.op === 'lte' ? '이하' : '이상'}` },
  return: { label: '최근 n일 수익률', text: c => `최근 ${c.n}일 수익률이 ${fmtPct(c.value, 0)} ${c.op === 'lte' ? '이하' : '이상'}` },
  volume: { label: '거래량 급증', text: c => `거래량이 직전 ${c.n}일 평균의 ${c.k}배 이상` },
  nearHigh: { label: '52주 신고가 근처', text: c => `종가가 52주 신고가 대비 ${c.pct}% 이내` },
};
const describeEntry = s => (s.entry.length ? s.entry.map(c => CONDS[c.type].text(c)).join(' 그리고 ') : '조건 없음 (사지 않아요)');
function describeExit({ takeProfit, stopLoss, maxHoldDays }) {
  const parts = [takeProfit > 0 && `익절 +${takeProfit}%`, stopLoss > 0 && `손절 −${stopLoss}%`, maxHoldDays > 0 && `최대 ${maxHoldDays}일 보유`].filter(Boolean);
  return parts.length ? parts.join(' · ') : '파는 규칙 없음 (끝까지 보유)';
}
function describeMoney({ initial, sizing, amount, percent, maxPositions }, m) {
  return `시작 ${fmtMoneyShort(initial, m)} · 1회 ${sizing === 'percent' ? `총자산의 ${percent}%` : fmtMoneyShort(amount, m)} · 최대 ${maxPositions}종목`;
}

function renderStrategies() {
  const m = curMarket(), view = $('strategiesView');
  const list = strategiesOf(m);
  const cards = list.map(s => h('article', 'card strategy',
    h('h3', '', s.name),
    h('dl', '',
      h('dt', '', '🛒 사요'), h('dd', '', `다음 날 시가에 · ${describeEntry(s)}`),
      h('dt', '', '💰 팔아요'), h('dd', '', describeExit(s.exit)),
      h('dt', '', '👛 자금'), h('dd', '', describeMoney(s.money, m))),
    h('div', 'actions', button('📊 결과 보기', () => {
      prefs.sel = { ...prefs.sel, [m]: s.id };
      setTab('results');
    }, 'btn primary')),
  ));
  view.replaceChildren(
    h('h2', '', `🧪 전략 · ${m === 'kr' ? '국내' : '미국'}`),
    list.length ? h('div', 'strategy-list', ...cards) : h('p', 'muted', '이 시장에는 전략이 없어요.'),
  );
}
