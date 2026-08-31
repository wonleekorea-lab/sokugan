const CACHE = "sokugan-v3.4";
self.addEventListener("install", e => self.skipWaiting());
// 旧バージョンのキャッシュを破棄してから制御を取る。
// これが無いと 3.1 のindex.htmlがキャッシュに残り、同期UIが出ない端末が生まれる。
self.addEventListener("activate", e => e.waitUntil((async () => {
  const names = await caches.keys();
  await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
  await clients.claim();
})()));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then(r => {
      const cp = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, cp));
      return r;
    }).catch(() => caches.match(e.request))
  );
});
