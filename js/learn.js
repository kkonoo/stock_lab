'use strict';
// 📖 공부 탭: 용어집 (data/glossary.json — GitHub에서 직접 항목을 더할 수 있음)
// 앱 곳곳의 ⓘ 버튼(infoBtn)을 누르면 이 탭의 그 용어로 옴

// glossary = { intro, path: [id], categories: [{ id, name }], terms: [{ id, cat, term, aka?, short, body: [], example?, see?: [] }] }
let glossary = null;
const termById = id => glossary?.terms.find(t => t.id === id);
const openTerms = new Set(); // 펼쳐 둔 용어 (다시 그려도 유지)
let learnQuery = '', jumpTo = null;

// ⓘ: 용어 설명으로 가기 (label 안에 있어도 입력칸이 눌리지 않게 막음)
function infoBtn(id) {
  const t = termById(id);
  const b = button('ⓘ', e => { e.preventDefault(); e.stopPropagation(); openTerm(id); }, 'info');
  b.title = t ? `${t.term} — 설명 보기` : '용어 설명 보기';
  b.setAttribute('aria-label', b.title);
  return b;
}
function openTerm(id) {
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  learnQuery = '';
  delete prefs.learnCat;
  jumpTo = id;
  setTab('learn');
}

// 이름 비교용: 대소문자·띄어쓰기 무시
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');

function renderLearn() {
  const view = $('learnView'), target = jumpTo;
  jumpTo = null;
  if (target) openTerms.add(target);
  if (!glossary) {
    return view.replaceChildren(h('h2', '', '📖 공부'), h('p', 'note warn', '⚠️ 용어집(data/glossary.json)을 못 읽었어요. 새로고침해 보세요.'));
  }
  const search = Object.assign(h('input', 'learn-search'), { type: 'search', value: learnQuery, placeholder: '🔎 용어 찾기 (예: 손절, MDD, 이동평균)' });
  search.setAttribute('aria-label', '용어 찾기');
  search.addEventListener('input', () => { learnQuery = search.value; drawList(); });

  const path = h('div', 'path', h('span', 'muted small', '🧭 처음 읽기 순서'));
  glossary.path.map(termById).filter(Boolean).forEach((t, i) => {
    if (i) path.append(h('span', 'faint', '›'));
    path.append(button(t.term.replace(/\s*\(.*\)$/, ''), () => jump(t.id), 'chip'));
  });

  const cats = h('div', 'path');
  const catBtn = (id, name) => {
    const b = button(name, () => { prefs.learnCat = id; savePrefs(); drawList(); for (const x of cats.children) x.classList.toggle('on', x === b); }, 'chip');
    b.classList.toggle('on', (prefs.learnCat || '') === id);
    return b;
  };
  cats.append(catBtn('', '전체'), ...glossary.categories.map(c => catBtn(c.id, c.name)));

  const list = h('div', 'term-list');
  function drawList() {
    const q = norm(learnQuery);
    const hit = t => norm([t.term, t.aka, t.short, ...(t.body || []), t.example].join(' ')).includes(q);
    const shown = glossary.terms.filter(t => (q ? hit(t) : !prefs.learnCat || t.cat === prefs.learnCat));
    list.replaceChildren();
    for (const c of glossary.categories) {
      const terms = shown.filter(t => t.cat === c.id);
      if (terms.length) list.append(h('h3', 'term-cat', c.name), ...terms.map(t => termCard(t, q && shown.length <= 3)));
    }
    if (!shown.length) list.append(h('p', 'muted', `'${learnQuery}'에 맞는 용어가 없어요.`));
  }
  // 함께 보기·읽기 순서: 이 탭 안에서 그 용어로 이동
  function jump(id) {
    if (learnQuery || (prefs.learnCat && termById(id)?.cat !== prefs.learnCat)) {
      learnQuery = '';
      search.value = '';
      prefs.learnCat = '';
      for (const x of cats.children) x.classList.toggle('on', x === cats.firstChild);
    }
    openTerms.add(id);
    drawList();
    focusTerm(id);
  }
  function termCard(t, forceOpen) {
    const d = h('details', 'term card');
    d.id = `term-${t.id}`;
    d.open = forceOpen || openTerms.has(t.id);
    d.addEventListener('toggle', () => (d.open ? openTerms.add(t.id) : openTerms.delete(t.id)));
    const see = (t.see || []).map(termById).filter(Boolean);
    d.append(
      h('summary', '', h('strong', '', t.term), h('span', 'muted', t.short)),
      h('div', 'term-body',
        ...(t.body || []).map(p => h('p', '', p)),
        t.example ? h('p', 'example', `💡 ${t.example}`) : null,
        see.length ? h('div', 'see', h('span', 'muted small', '🔗 함께 보기'), ...see.map(s => button(s.term, () => jump(s.id), 'chip'))) : null),
    );
    return d;
  }

  view.replaceChildren(
    h('h2', '', '📖 공부'),
    h('p', 'muted', glossary.intro),
    search, path, cats, list,
    h('p', 'muted small', '✏️ 용어는 GitHub의 data/glossary.json에서 더하거나 고칠 수 있어요.'),
  );
  drawList();
  if (target) requestAnimationFrame(() => focusTerm(target)); // setTab이 맨 위로 올린 뒤에 이동
}
function focusTerm(id) {
  const el = $(`term-${id}`);
  if (!el) return;
  el.open = true;
  el.scrollIntoView({ block: 'start' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1200);
}
