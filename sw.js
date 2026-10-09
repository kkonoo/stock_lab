// 오프라인에서도 열리게 하는 서비스 워커.
// 내 파일(앱·시세 JSON)은 온라인이면 항상 새로 받고(업데이트 바로 반영), 오프라인이면 저장해 둔 걸 씀.
// 같은 주소(kkonoo.github.io)의 다른 앱과 캐시 저장소를 같이 쓰므로 이름을 다르게, 남의 캐시는 지우지 않기
const CACHE = 'stocklab-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/engine.js', 'js/config.js', 'js/app.js', 'js/learn.js', 'js/builder.js', 'js/results.js', 'data/glossary.json',
  'icons/app-192.png', 'icons/app-512.png', 'icons/app-maskable-192.png', 'icons/app-maskable-512.png',
];
// 차트 라이브러리: 버전이 고정이라 안 바뀜 → 저장해 둔 것 먼저
const CHART_LIB = 'https://cdn.jsdelivr.net/npm/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js';

self.addEventListener('install', e => {
  self.skipWaiting(); // 새 서비스 워커를 앱을 껐다 켜지 않아도 바로 사용
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).then(() => c.add(CHART_LIB).catch(() => {}))));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.href === CHART_LIB) {
    e.respondWith(caches.match(CHART_LIB, { cacheName: CACHE }).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(CHART_LIB, copy));
      return res;
    })));
    return;
  }
  if (url.origin !== location.origin) return; // 폰트 등 다른 바깥 요청은 건드리지 않음
  e.respondWith(
    // no-cache: 브라우저 캐시(GitHub Pages는 10분)를 쓰기 전에 서버에 바뀌었는지 확인
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        const copy = res.clone();
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { cacheName: CACHE, ignoreSearch: true }))
  );
});
