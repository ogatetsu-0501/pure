// GitHub ActionsでバザーAPIを取得し、ローカルJSONを更新します。
// 更新が正常完了したときのみ保存して、取得失敗による欠損を防ぎます。
import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { collectIncrementalBazaarData } from './incremental-bazaar.mjs';
import { mergeTradeLists } from './male-trade.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const TRADE_URL = 'https://puretomo-ap.hange.jp/api/noauth/itemtrade/search.json?sort=newItem&pageCount=10000';
const MALE_TRADE_URL = 'https://puretomo-ap.hange.jp/api/itemtrade/search.json?bagcat=F&page=1&pageCount=10000';
const DETAIL_URL = 'https://puretomo-ap.hange.jp/api/noauth/bazaar/itemDetail.json?category=hancoin&itemCode=';
const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 1500;
const REQUEST_TIMEOUT_MS = 20000;
const CACHE_FILE = '.cache/bazaar-details.json.gz';

// HTTPエラー・タイムアウトが発生した場合は適切な回数だけ再取得します。
export async function fetchJsonWithRetry(url, { fetchImpl = fetch, retryCount = RETRY_COUNT, delayMs = RETRY_DELAY_MS, headers } = {}) {
  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers });
      if (!response.ok) {
        const canRetry = response.status === 429 || response.status >= 500;
        if (!canRetry) throw new Error('HTTP ' + response.status + ': ' + url);
        throw Object.assign(new Error('HTTP ' + response.status + ': ' + url), { canRetry: true });
      }
      return await response.json();
    } catch (error) {
      const isHttpClientError = !!error.message?.startsWith('HTTP 4') && !error.canRetry;
      const isLastAttempt = attempt === retryCount;
      if (isHttpClientError || isLastAttempt) throw error;
      console.warn('API取得を再試行します (' + attempt + '/' + retryCount + '): ' + url + ' - ' + error.message);
      await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
    }
  }
}

// 公開データの正本は同じリポジトリ内のJSONです。
export async function runUpdate({ loadTrade, loadMaleTrade, loadDetail, dataRoot = projectRoot, now } = {}) {
  const root = dataRoot;
  // 公開一覧は必須です。ここが失敗した場合は旧データを保護して更新を停止します。
  const [schema, statusesCsv, labelsCsv, maleHistory, femaleHistory, publicTradeData] = await Promise.all([
    readFile(path.join(root, 'itemCodeSchema.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'type_options.csv'), 'utf8'),
    readFile(path.join(root, 'bagcat_labels.csv'), 'utf8'),
    readFile(path.join(root, 'malebuzzerHistory.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'femalebuzzerHistory.json'), 'utf8').then(JSON.parse),
    loadTrade ? loadTrade() : fetchJsonWithRetry(TRADE_URL),
  ]);
  const isValidPublicData = publicTradeData?.status === 'SUCCESS'
    && Array.isArray(publicTradeData?.result?.itemList);
  if (!isValidPublicData) throw new Error('公開一覧APIの応答が不正です');

  // 男性用APIは任意です。認証期限切れなどでも公開一覧の更新を止めません。
  // CookieはGitHub Actions Secretsで管理し、ログや保存データには出力しません。
  const cookie = process.env.HANGE_SESSION_COOKIE;
  const shouldLoadMale = !!loadMaleTrade || (!!cookie && !loadTrade);
  let tradeData = publicTradeData;
  let maleCodes = new Set();
  let maleApiMode = 'public-only';
  if (shouldLoadMale) {
    try {
      const maleTradeData = await (loadMaleTrade
        ? loadMaleTrade()
        : fetchJsonWithRetry(MALE_TRADE_URL, { headers: { Cookie: cookie, Accept: 'application/json' } }));
      const merged = mergeTradeLists(publicTradeData, maleTradeData);
      tradeData = merged.tradeData;
      maleCodes = merged.maleCodes;
      maleApiMode = 'full';
    } catch (error) {
      // 認証失敗・取得失敗・一覧不完全のいずれでも、男性用データを混ぜずに公開モードへ移行。
      console.warn('男性用一覧を取得できませんでした。非ログインAPIだけで更新します:', error.message);
    }
  } else {
    console.log('男性用Cookieなし。非ログインAPIだけで更新します');
  }
  console.log('バザー取得モード:', maleApiMode);
  const cachePath = path.join(root, CACHE_FILE);
  let cacheState = null;
  try {
    const compressed = await readFile(cachePath);
    const decoded = JSON.parse(gunzipSync(compressed).toString('utf8'));
    if (decoded.version === 1 && decoded.entries && typeof decoded.entries === 'object') cacheState = decoded;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('過去のキャッシュを読み込めませんでした:', error.message);
  }
  const previousListings = await readFile(path.join(root, 'bazzarList.json'), 'utf8').then(JSON.parse);
  const another = await readFile(path.join(root, 'itemAnother.json'), 'utf8').then(JSON.parse);
  const { data: result, cacheState: updatedCache, statistics } = await collectIncrementalBazaarData({
    schema, another, previousListings, statusesCsv, labelsCsv, maleHistory, femaleHistory,
    tradeData, cacheState,
    // 認証切れの間は男性専用キャッシュと価格履歴を保持し、公開一覧だけ更新します。
    preserveMissingCache: maleApiMode === 'public-only',
    updateMaleHistory: maleApiMode === 'full',
    loadDetail: loadDetail || (code => fetchJsonWithRetry(
      DETAIL_URL + encodeURIComponent(code) + '&pageCount=10000',
      { headers: maleCodes.has(code) ? { Cookie: cookie, Accept: 'application/json' } : undefined },
    )),
    now: now || new Date(),
  });
  // 参照キャッシュはGitHub Actionsのキャッシュ領域へ保存する。
  await mkdir(path.dirname(cachePath), { recursive: true });
  const newCacheFile = cachePath + '.tmp';
  await writeFile(newCacheFile, gzipSync(JSON.stringify(updatedCache), { level: 6 }));
  await rename(newCacheFile, cachePath);
  result['update-status.json']['male-api-mode'] = maleApiMode;
  console.log('差分取得:', JSON.stringify(statistics));
  // 全データの取得が完了した場合に限って、変更されたJSONを更新します。
  let hasChanged = false;
  for (const [filename, data] of Object.entries(result)) {
    if (filename === 'update-status.json') continue;
    const target = path.join(root, filename);
    const content = JSON.stringify(data, null, 2);
    const previous = await readFile(target, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    if (previous === content) continue;
    hasChanged = true;
    const temporary = target + '.tmp';
    await writeFile(temporary, content, 'utf8');
    await rename(temporary, target);
    console.log('更新: ' + filename);
  }
  // データ件数が同じでも取得モードが切り替わったことはサイトへ反映します。
  const statusPath = path.join(root, 'update-status.json');
  const previousStatus = await readFile(statusPath, 'utf8')
    .then(JSON.parse)
    .catch(error => {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return {};
      throw error;
    });
  const hasModeChanged = previousStatus['male-api-mode'] !== maleApiMode;
  if (hasChanged || hasModeChanged) {
    const temp = statusPath + '.tmp';
    await writeFile(temp, JSON.stringify(result['update-status.json'], null, 2), 'utf8');
    await rename(temp, statusPath);
    console.log('更新: update-status.json');
  }
  console.log('バザー集計完了: ' + result['bazzarList.json'].length + '件');
  return result;
}

// import時は起動せず、スクリプトとして呼ばれた場合だけ取得を行います。
const isMain = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runUpdate().catch(error => {
    console.error('バザー更新失敗。旧データを維持します:', error);
    process.exitCode = 1;
  });
}
