// Puretomoアバター画像は利用者のブラウザ内でのみ保存します。
// 取得済みならネットワークにアクセスせずキャッシュを返します（cache-first）。
// API通信や画像の一括ダウンロードは行わず、画面が要求した画像だけ扱います。
const IMAGE_CACHE = 'puretomo-avatar-images-v1';
const MAX_IMAGES = 300;
const inFlight = new Map();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

async function cacheFirstImage(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached; // 一度保存された画像は、再訪時も通信せず再利用する。

  // 同じ画像を同時に表示しても1回だけ取得します。
  const key = request.url;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(request);
      if (response.ok || response.type === 'opaque') {
        try {
          await cache.put(request, response.clone());
          // 保存上限を超えた古い画像から削除します（端末容量の保護）。
          const keys = await cache.keys();
          for (const old of keys.slice(0, Math.max(0, keys.length - MAX_IMAGES))) {
            await cache.delete(old);
          }
        } catch (error) {
          // 容量不足・ブラウザ制限時は画像表示を優先して通常応答を返す。
          console.warn('[Puretomo画像キャッシュ] 保存できませんでした:', error);
        }
      }
      return response;
    })();
    inFlight.set(key, pending);
  }
  try {
    return (await pending).clone();
  } finally {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // 画像サーバーのアバター画像だけ対象。API・他サイトの画像は扱いません。
  if (request.destination !== 'image' ||
      url.hostname !== 'puretomo-image.hange.jp' ||
      !url.pathname.startsWith('/disp/')) return;
  event.respondWith(cacheFirstImage(request));
});
