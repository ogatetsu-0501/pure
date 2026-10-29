// Puretomo 画像専用キャッシュ: ユーザー端末側で公開アバター画像を再利用する。
// バザー API への通信はGitHub Actionsのみ。SWはAPIリクエストを扱わない。
const IMAGE_CACHE = 'puretomo-avatar-images-v1';
const MAX_IMAGES = 300;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.destination !== 'image' || url.hostname !== 'puretomo-image.hange.jp') return;
  event.respondWith((async () => {
    const cache = await caches.open(IMAGE_CACHE);
    const saved = await cache.match(req);
    if (saved) return saved;
    try {
      const response = await fetch(req);
      if (response.ok || response.type === 'opaque') {
        // イメージはitemCodeで指定されるものだけを保管し、端末容量を制限する。
        await cache.put(req, response.clone()).catch(() => {});
        const keys = await cache.keys();
        const overflow = keys.length - MAX_IMAGES;
        for (let index = 0; index < overflow; index++) await cache.delete(keys[index]);
      }
      return response;
    } catch (error) {
      const cached = await cache.match(req);
      if (cached) return cached;
      throw error;
    }
  })());
});
