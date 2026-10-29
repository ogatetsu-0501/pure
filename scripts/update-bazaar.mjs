// GitHub ActionsでバザーAPIを取得し、ローカルJSONを更新します。
// 更新が正常完了したときのみ保存して、取得失敗による欠損を防ぎます。
import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { collectBazaarData } from './bazaar-core.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const TRADE_URL = 'https://puretomo-ap.hange.jp/api/noauth/itemtrade/search.json?sort=newItem&pageCount=10000';
const DETAIL_URL = 'https://puretomo-ap.hange.jp/api/noauth/bazaar/itemDetail.json?category=hancoin&itemCode=';
const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 1500;
const REQUEST_TIMEOUT_MS = 20000;
const DETAIL_CONCURRENCY = 10;

// HTTPエラー・タイムアウトが発生した場合は適切な回数だけ再取得します。
export async function fetchJsonWithRetry(url, { fetchImpl = fetch, retryCount = RETRY_COUNT, delayMs = RETRY_DELAY_MS } = {}) {
  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
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
export async function runUpdate({ loadTrade, loadDetail, dataRoot = projectRoot, now } = {}) {
  const root = dataRoot;
  const [schema, statusesCsv, labelsCsv, maleHistory, femaleHistory, tradeData] = await Promise.all([
    readFile(path.join(root, 'itemCodeSchema.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'type_options.csv'), 'utf8'),
    readFile(path.join(root, 'bagcat_labels.csv'), 'utf8'),
    readFile(path.join(root, 'malebuzzerHistory.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'femalebuzzerHistory.json'), 'utf8').then(JSON.parse),
    loadTrade ? loadTrade() : fetchJsonWithRetry(TRADE_URL),
  ]);
  const result = await collectBazaarData({
    schema, statusesCsv, labelsCsv, maleHistory, femaleHistory, tradeData,
    loadDetail: loadDetail || (code => fetchJsonWithRetry(DETAIL_URL + encodeURIComponent(code) + '&pageCount=10000')),
    concurrency: DETAIL_CONCURRENCY, now,
  });
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
  if (hasChanged) {
    const target = path.join(root, 'update-status.json');
    const temp = target + '.tmp';
    await writeFile(temp, JSON.stringify(result['update-status.json'], null, 2), 'utf8');
    await rename(temp, target);
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
