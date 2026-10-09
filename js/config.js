'use strict';
// 기본값 모음. 앱은 ⚙️ 설정에 저장한 값을 쓰고, 저장한 게 없을 때만 여기 값을 씀

// 시장별 비용(%) — 예시값이에요. 실제 요율은 증권사·세법을 확인하고 ⚙️ 설정에서 고쳐 주세요
const DEFAULT_COSTS = {
  kr: { buyFee: 0.015, sellFee: 0.015, sellTax: 0.2, slippage: 0.1 },
  us: { buyFee: 0.25, sellFee: 0.25, sellTax: 0, slippage: 0.05 },
};

// 처음 열었을 때 넣어 두는 예시 전략 (스윙매매: 며칠~몇 주 보유). 고치거나 지워도 다시 생기지 않음
const SAMPLE_MONEY = {
  kr: { initial: 10000000, sizing: 'fixed', amount: 2000000, percent: 20, maxPositions: 5 },
  us: { initial: 10000, sizing: 'fixed', amount: 2000, percent: 20, maxPositions: 5 },
};
const SAMPLE_STRATEGIES = [
  {
    name: '🌱 골든크로스 + 거래량',
    entry: [{ type: 'maCross', short: 5, long: 20, dir: 'golden' }, { type: 'volume', n: 20, k: 1.5 }],
    exit: { takeProfit: 10, stopLoss: 5, maxHoldDays: 20 },
  },
  {
    name: '🎯 눌림목 (상승 추세 속 RSI 하락)',
    entry: [{ type: 'priceVsMa', n: 60, op: 'above' }, { type: 'rsi', n: 14, op: 'lte', value: 40 }],
    exit: { takeProfit: 8, stopLoss: 4, maxHoldDays: 10 },
  },
  {
    name: '🚀 52주 신고가 돌파',
    entry: [{ type: 'nearHigh', pct: 3 }, { type: 'volume', n: 20, k: 2 }],
    exit: { takeProfit: 15, stopLoss: 7, maxHoldDays: 30 },
  },
];
