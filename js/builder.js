'use strict';
// 🧪 전략 탭: 전략 목록, 조건 빌더(고치면 바로 저장), JSON 내보내기·불러오기

// ---------- 매수 조건 종류 (계산은 engine.js의 Engine.CONDITIONS) ----------
// form = 문장 사이에 입력칸을 끼운 모양. num(키, 최소, 최대, 단위, 간격) · sel(키, [[값, 글자]])
const num = (key, min, max, unit = '', step = 1) => ({ key, kind: 'num', min, max, unit, step });
const sel = (key, options) => ({ key, kind: 'sel', options });
const UP_DOWN = [['gte', '이상'], ['lte', '이하']];
const CONDS = {
  priceVsMa: {
    label: '종가 vs 이동평균', term: 'moving-average', init: { n: 20, op: 'above' },
    form: ['종가가', num('n', 1, 250, '일'), '이동평균', sel('op', [['above', '위'], ['below', '아래']])],
    text: c => `종가가 ${c.n}일 이동평균 ${c.op === 'below' ? '아래' : '위'}`,
  },
  maCross: {
    label: '골든크로스 / 데드크로스', term: 'golden-cross', init: { short: 5, long: 20, dir: 'golden' },
    form: [num('short', 1, 250, '일선이'), num('long', 2, 250, '일선을'), sel('dir', [['golden', '뚫고 올라감 (골든크로스)'], ['dead', '뚫고 내려감 (데드크로스)']])],
    text: c => `${c.short}일선이 ${c.long}일선을 ${c.dir === 'dead' ? '뚫고 내려감 (데드크로스)' : '뚫고 올라감 (골든크로스)'}`,
    check: c => (c.short >= c.long ? '단기(앞) 이동평균 기간이 장기(뒤)보다 짧아야 해요.' : ''),
  },
  rsi: {
    label: 'RSI', term: 'rsi', init: { n: 14, op: 'lte', value: 30 },
    form: ['RSI', num('n', 2, 100, '일'), '값이', num('value', 0, 100), sel('op', UP_DOWN)],
    text: c => `RSI(${c.n})가 ${c.value} ${c.op === 'lte' ? '이하' : '이상'}`,
  },
  return: {
    label: '최근 n일 수익률', term: 'momentum', init: { n: 5, op: 'lte', value: -10 },
    form: ['최근', num('n', 1, 250, '일'), '수익률이', num('value', -100, 1000, '%', 0.1), sel('op', UP_DOWN)],
    text: c => `최근 ${c.n}일 수익률이 ${fmtPct(c.value, 0)} ${c.op === 'lte' ? '이하' : '이상'}`,
  },
  volume: {
    label: '거래량 급증', term: 'volume-spike', init: { n: 20, k: 2 },
    form: ['거래량이 직전', num('n', 1, 250, '일'), '평균의', num('k', 0.1, 100, '배', 0.1), '이상'],
    text: c => `거래량이 직전 ${c.n}일 평균의 ${c.k}배 이상`,
  },
  nearHigh: {
    label: '52주 신고가 근처', term: '52w-high', init: { pct: 5 },
    form: ['종가가 52주 신고가 대비', num('pct', 0, 100, '%', 0.1), '이내'],
    text: c => `종가가 52주 신고가 대비 ${c.pct}% 이내`,
  },
};

// ---------- 설명 (목록 카드용) ----------
const describeEntry = s => (s.entry.length ? s.entry.map(c => CONDS[c.type].text(c)).join(' 그리고 ') : '조건 없음 (사지 않아요)');
function describeExit({ takeProfit, stopLoss, maxHoldDays }) {
  const parts = [takeProfit > 0 && `익절 +${takeProfit}%`, stopLoss > 0 && `손절 −${stopLoss}%`, maxHoldDays > 0 && `최대 ${maxHoldDays}일 보유`].filter(Boolean);
  return parts.length ? parts.join(' · ') : '파는 규칙 없음 (끝까지 보유)';
}
function describeMoney({ initial, sizing, amount, percent, maxPositions }, m) {
  return `시작 ${fmtMoneyShort(initial, m)} · 1회 ${sizing === 'percent' ? `총자산의 ${percent}%` : fmtMoneyShort(amount, m)} · 최대 ${maxPositions}종목`;
}

// ---------- 전략 만들기·지우기 ----------
function newStrategy(m) {
  const s = { id: uid(), market: m, name: '새 전략', entry: [], exit: { takeProfit: 10, stopLoss: 5, maxHoldDays: 20 }, money: clone(SAMPLE_MONEY[m]) };
  db.strategies.push(s);
  saveDb();
  openEditor(s);
}
function copyStrategy(s) {
  const c = { ...clone(s), id: uid(), name: `${s.name} (복사)` };
  db.strategies.splice(db.strategies.indexOf(s) + 1, 0, c);
  saveDb();
  openEditor(c);
}
function deleteStrategy(s) {
  if (!confirm(`'${s.name}' 전략을 지울까요?`)) return;
  db.strategies.splice(db.strategies.indexOf(s), 1);
  saveDb();
  delete prefs.edit;
  savePrefs();
  render();
}
function openEditor(s) { prefs.edit = s.id; savePrefs(); render(); window.scrollTo(0, 0); }

// ---------- 📤 내보내기 · 📥 불러오기 ----------
function exportStrategies() {
  const data = { app: 'stock_lab', version: 1, exportedAt: new Date().toISOString(), strategies: db.strategies.map(({ id, ...s }) => s) };
  const a = h('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `stocklab-strategies-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// 바깥 파일에서 온 전략을 앱이 아는 모양으로만 다듬음 (모르는 조건·이상한 값은 버리거나 기본값)
function cleanStrategy(o) {
  if (!o || typeof o !== 'object' || !['kr', 'us'].includes(o.market)) throw new Error('시장(market)이 kr 또는 us가 아니에요');
  const m = o.market, okNum = v => typeof v === 'number' && isFinite(v);
  const entry = (Array.isArray(o.entry) ? o.entry : []).filter(c => c && CONDS[c.type]).map(c => {
    const def = CONDS[c.type], out = { type: c.type, ...def.init };
    for (const f of def.form) {
      if (typeof f === 'string') continue;
      const v = c[f.key];
      if (f.kind === 'num' && okNum(v) && v >= f.min && v <= f.max) out[f.key] = v;
      if (f.kind === 'sel' && f.options.some(([x]) => x === v)) out[f.key] = v;
    }
    return out;
  });
  const ex = o.exit || {}, mo = o.money || {};
  const pos = (v, max = Infinity) => (okNum(v) && v > 0 && v <= max ? v : null);
  const money = { ...SAMPLE_MONEY[m] };
  if (pos(mo.initial)) money.initial = mo.initial;
  if (['fixed', 'percent'].includes(mo.sizing)) money.sizing = mo.sizing;
  if (pos(mo.amount)) money.amount = mo.amount;
  if (pos(mo.percent, 100)) money.percent = mo.percent;
  if (pos(mo.maxPositions) && Number.isInteger(mo.maxPositions)) money.maxPositions = mo.maxPositions;
  return {
    id: uid(), market: m, name: String(o.name || '불러온 전략').slice(0, 60), entry,
    exit: { takeProfit: pos(ex.takeProfit), stopLoss: pos(ex.stopLoss, 100), maxHoldDays: pos(ex.maxHoldDays) && Math.round(ex.maxHoldDays) },
    money,
  };
}
async function importStrategies(file) {
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : Array.isArray(data.strategies) ? data.strategies : [data];
    const ok = [], bad = [];
    list.forEach((o, i) => { try { ok.push(cleanStrategy(o)); } catch (e) { bad.push(`${i + 1}번째: ${e.message}`); } });
    db.strategies.push(...ok);
    saveDb();
    render();
    const where = ['kr', 'us'].map(m => [m, ok.filter(s => s.market === m).length]).filter(([, n]) => n).map(([m, n]) => `${m === 'kr' ? '국내' : '미국'} ${n}개`).join(', ');
    alert([ok.length ? `📥 ${ok.length}개 불러왔어요 (${where}).` : '불러온 전략이 없어요.', ...bad].join('\n'));
  } catch (e) {
    alert(`JSON 파일을 읽지 못했어요: ${e.message}`);
  }
}

// ---------- 목록 ----------
function renderStrategies() {
  const m = curMarket(), list = strategiesOf(m);
  const editing = list.find(s => s.id === prefs.edit);
  if (editing) return renderEditor(editing);

  const file = Object.assign(h('input'), { type: 'file', accept: '.json,application/json', hidden: true });
  file.addEventListener('change', () => { if (file.files[0]) importStrategies(file.files[0]); file.value = ''; });
  const cards = list.map(s => h('article', 'card strategy',
    h('h3', '', s.name),
    h('dl', '',
      h('dt', '', '🛒 사요'), h('dd', '', `다음 날 시가에 · ${describeEntry(s)}`),
      h('dt', '', '💰 팔아요'), h('dd', '', describeExit(s.exit)),
      h('dt', '', '👛 자금'), h('dd', '', describeMoney(s.money, m))),
    h('div', 'actions',
      button('📊 결과 보기', () => { prefs.sel = { ...prefs.sel, [m]: s.id }; setTab('results'); }, 'btn primary'),
      button('✏️ 고치기', () => openEditor(s))),
  ));
  $('strategiesView').replaceChildren(
    h('div', 'list-head',
      h('h2', '', `🧪 전략 · ${m === 'kr' ? '국내' : '미국'}`),
      h('div', 'actions',
        button('＋ 새 전략', () => newStrategy(m), 'btn primary'),
        button('📤 내보내기', exportStrategies),
        button('📥 불러오기', () => file.click()),
        file)),
    h('p', 'muted small', '내보내기는 국내·미국 전략을 모두 JSON 파일 하나로 저장해요. 불러오면 지금 전략은 그대로 두고 새로 더해요.'),
    list.length ? h('div', 'strategy-list', ...cards) : h('p', 'note', '이 시장에는 전략이 없어요. ＋ 새 전략으로 만들어 보세요.'),
  );
}

// ---------- 편집기: 고치면 바로 저장 ----------
// 숫자 칸: 범위를 벗어나거나 비우면 이전 값으로 되돌림 (optional이면 비워서 '없음')
function numInput(get, set, { min = 0, max = Infinity, step = 1, int = false, optional = false, width = '' } = {}) {
  const i = h('input', `num-input ${width}`);
  Object.assign(i, { type: 'number', min, step, inputMode: int ? 'numeric' : 'decimal' });
  if (max !== Infinity) i.max = max;
  if (optional) i.placeholder = '없음';
  i.value = get() ?? '';
  i.addEventListener('change', () => {
    if (optional && i.value.trim() === '') { set(null); saveDb(); i.dispatchEvent(new Event('saved', { bubbles: true })); return; }
    const v = Number(i.value);
    if (i.value.trim() === '' || !isFinite(v) || v < min || v > max || (int && !Number.isInteger(v))) { i.value = get() ?? ''; i.classList.add('bad'); setTimeout(() => i.classList.remove('bad'), 800); return; }
    set(v);
    saveDb();
    i.dispatchEvent(new Event('saved', { bubbles: true }));
  });
  return i;
}
function selectInput(options, get, set) {
  const s = h('select', 'sel-input');
  for (const [v, label] of options) s.append(Object.assign(h('option', '', label), { value: v, selected: get() === v }));
  s.addEventListener('change', () => { set(s.value); saveDb(); s.dispatchEvent(new Event('saved', { bubbles: true })); });
  return s;
}

function conditionRow(s, c, redraw) {
  const def = CONDS[c.type], warn = h('div', 'cond-warn');
  const showWarn = () => { warn.textContent = def.check?.(c) || ''; };
  const sentence = h('div', 'cond-sentence');
  for (const f of def.form) {
    if (typeof f === 'string') { sentence.append(h('span', '', f)); continue; }
    const input = f.kind === 'num'
      ? numInput(() => c[f.key], v => { c[f.key] = v; }, { min: f.min, max: f.max, step: f.step, int: f.step === 1, width: 'w-s' })
      : selectInput(f.options, () => c[f.key], v => { c[f.key] = v; });
    input.addEventListener('saved', showWarn);
    sentence.append(f.unit ? h('span', 'with-unit', input, h('span', '', f.unit)) : input);
  }
  showWarn();
  const del = button('✕', () => { s.entry.splice(s.entry.indexOf(c), 1); saveDb(); redraw(); }, 'icon-btn small');
  del.title = '이 조건 빼기';
  del.setAttribute('aria-label', '이 조건 빼기');
  return h('div', 'cond-row', h('span', 'cond-type', def.label, infoBtn(def.term)), sentence, del, warn);
}

function renderEditor(s) {
  const m = s.market, view = $('strategiesView');
  const redraw = () => renderEditor(s);
  const unit = m === 'us' ? '$' : '원';

  // 이름
  const name = Object.assign(h('input', 'name-input'), { value: s.name, maxLength: 60 });
  name.setAttribute('aria-label', '전략 이름');
  name.addEventListener('change', () => { s.name = name.value.trim() || '이름 없는 전략'; name.value = s.name; saveDb(); });

  // 매수 조건
  const conds = h('div', 'conds', ...s.entry.map(c => conditionRow(s, c, redraw)));
  if (!s.entry.length) conds.append(h('p', 'muted', '아직 조건이 없어요. 아래에서 조건을 더해 보세요. 조건이 없으면 사지 않아요.'));
  const add = h('select', 'add-cond');
  add.setAttribute('aria-label', '조건 추가');
  add.append(Object.assign(h('option', '', '＋ 조건 추가…'), { value: '' }));
  for (const [type, def] of Object.entries(CONDS)) add.append(Object.assign(h('option', '', def.label), { value: type }));
  add.addEventListener('change', () => {
    if (!add.value) return;
    s.entry.push({ type: add.value, ...clone(CONDS[add.value].init) });
    saveDb();
    redraw();
  });

  // 매도 규칙
  const ex = s.exit;
  const exitBox = h('div', 'form-grid',
    h('label', 'field', h('span', '', '🎯 익절 (이만큼 오르면 팔기)', infoBtn('take-profit')), h('span', 'with-unit', h('span', '', '+'), numInput(() => ex.takeProfit, v => { ex.takeProfit = v; }, { min: 0.1, max: 1000, step: 0.1, optional: true }), h('span', '', '%'))),
    h('label', 'field', h('span', '', '🛑 손절 (이만큼 내리면 팔기)', infoBtn('stop-loss')), h('span', 'with-unit', h('span', '', '−'), numInput(() => ex.stopLoss, v => { ex.stopLoss = v; }, { min: 0.1, max: 99, step: 0.1, optional: true }), h('span', '', '%'))),
    h('label', 'field', h('span', '', '⏰ 최대 보유일 (지나면 그날 종가에 팔기)', infoBtn('holding-period')), h('span', 'with-unit', numInput(() => ex.maxHoldDays, v => { ex.maxHoldDays = v; }, { min: 1, max: 1000, int: true, optional: true }), h('span', '', '거래일'))),
  );
  const exitWarn = h('p', 'cond-warn');
  const checkExit = () => { exitWarn.textContent = ex.takeProfit > 0 || ex.stopLoss > 0 || ex.maxHoldDays > 0 ? '' : '파는 규칙이 하나도 없으면 산 종목을 끝까지 들고 있어요.'; };
  exitBox.addEventListener('saved', checkExit);
  checkExit();

  // 자금
  const mo = s.money;
  const hint = (get) => {
    const e = h('span', 'hint');
    const set = () => { e.textContent = get() > 0 ? `= ${fmtMoneyShort(get(), m)}` : ''; };
    set();
    return [e, set];
  };
  const [initHint, initSet] = hint(() => mo.initial);
  const [amtHint, amtSet] = hint(() => mo.amount);
  const initial = numInput(() => mo.initial, v => { mo.initial = v; }, { min: 1, step: m === 'us' ? 100 : 100000, width: 'w-l' });
  initial.addEventListener('saved', initSet);
  const amount = numInput(() => mo.amount, v => { mo.amount = v; }, { min: 1, step: m === 'us' ? 100 : 100000, width: 'w-l' });
  amount.addEventListener('saved', amtSet);
  const percent = numInput(() => mo.percent, v => { mo.percent = v; }, { min: 0.1, max: 100, step: 0.1 });
  const sizing = h('div', 'seg');
  for (const [v, label] of [['fixed', '고정 금액'], ['percent', '총자산의 %']]) {
    const b = button(label, () => { mo.sizing = v; saveDb(); redraw(); });
    b.classList.toggle('on', mo.sizing === v);
    sizing.append(b);
  }
  const moneyBox = h('div', 'form-grid',
    h('label', 'field', h('span', '', '시작 자본'), h('span', 'with-unit', initial, h('span', '', unit), initHint)),
    h('div', 'field', h('span', '', '1회 매수 금액', infoBtn('position-sizing')), sizing,
      mo.sizing === 'percent'
        ? h('span', 'with-unit', h('span', '', '총자산의'), percent, h('span', '', '%'))
        : h('span', 'with-unit', amount, h('span', '', unit), amtHint)),
    h('label', 'field', h('span', '', '최대 동시 보유', infoBtn('exposure')), h('span', 'with-unit', numInput(() => mo.maxPositions, v => { mo.maxPositions = v; }, { min: 1, max: 50, int: true }), h('span', '', '종목'))),
  );

  const back = button('‹ 목록', () => { delete prefs.edit; savePrefs(); render(); }, 'btn ghost');
  view.replaceChildren(
    h('div', 'list-head', back, h('div', 'actions',
      button('📊 결과 보기', () => { prefs.sel = { ...prefs.sel, [m]: s.id }; setTab('results'); }, 'btn primary'),
      button('⧉ 복제', () => copyStrategy(s)),
      button('🗑️ 지우기', () => deleteStrategy(s)))),
    h('div', 'editor',
      h('div', 'name-row', name, h('span', 'muted small', `${m === 'kr' ? '🇰🇷 국내' : '🇺🇸 미국'} · 고치면 바로 저장돼요`)),
      h('section', 'card',
        h('h3', '', '🛒 언제 살까요? (모두 만족할 때)', infoBtn('signal')),
        h('p', 'muted small', '그날 종가 기준으로 조건을 모두 만족하면, 다음 날 시가에 사요.'),
        conds, add),
      h('section', 'card',
        h('h3', '', '💰 언제 팔까요?', infoBtn('swing-trading')),
        h('p', 'muted small', '먼저 닿는 규칙으로 팔아요. 칸을 비우면 그 규칙은 안 써요. 같은 날 익절가·손절가에 둘 다 닿으면 손절로 쳐요.'),
        exitBox, exitWarn),
      h('section', 'card',
        h('h3', '', '👛 돈은 얼마나?', infoBtn('position-sizing')),
        h('p', 'muted small', '같은 종목은 한 번만 사요. 자리가 다 찼거나 현금이 모자라면 그 신호는 건너뛰어요.'),
        moneyBox),
    ),
  );
}
