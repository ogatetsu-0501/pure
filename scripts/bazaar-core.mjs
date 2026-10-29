// バザー集計の純粋な処理。API通信とファイル操作を分離する。
const HISTORY_NEW_MINUTES = 70;
const HISTORY_MERGE_MINUTES = 50;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_DISCOVERY_ROUNDS = 50;

// 並列実行数を制御しながら、取得結果の並びを維持する。
export async function mapWithConcurrency(items, concurrency, task) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function work() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => work()));
  return results;
}

// 新しい形式の履歴要素はvalueだけを比較する。
function unwrapHistoryEntry(entry) {
  const hasWrappedValue = !!entry && typeof entry === 'object' && 'value' in entry;
  return hasWrappedValue ? entry.value : entry;
}

// 50分・70分の履歴圧縮ルールと1年以上の古いデータの整理。
export function mergeAndCleanHistory(lowestMap, history, timestamp, now = new Date()) {
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) throw new Error('APIのserverTimeが不正です');
  for (const [stat, parameters] of Object.entries(lowestMap)) {
    history[stat] ||= {};
    for (const [parameter, parts] of Object.entries(parameters)) {
      history[stat][parameter] ||= {};
      for (const [part, rawValue] of Object.entries(parts)) {
        history[stat][parameter][part] ||= {};
        const entries = history[stat][parameter][part];
        const timestamps = Object.keys(entries).sort();
        if (!timestamps.length) {
          entries[timestamp] = { value: rawValue, NEW: true };
          continue;
        }
        if (timestamps.length === 1) {
          entries[timestamp] = rawValue;
          continue;
        }
        const lastTimestamp = timestamps.at(-1);
        const minutes = (timestampMs - Date.parse(lastTimestamp)) / 60000;
        if (minutes >= HISTORY_NEW_MINUTES) {
          entries[timestamp] = { value: rawValue, NEW: true };
        } else if (minutes >= HISTORY_MERGE_MINUTES) {
          if (rawValue === unwrapHistoryEntry(entries[lastTimestamp])) delete entries[lastTimestamp];
          entries[timestamp] = rawValue;
        }
      }
    }
  }
  for (const parameters of Object.values(history)) {
    for (const parts of Object.values(parameters)) {
      for (const entries of Object.values(parts)) {
        const timestamps = Object.keys(entries).sort();
        if (timestamps.length < 2) continue;
        const oldest = timestamps[0];
        const next = timestamps[1];
        const gap = Date.parse(next) - Date.parse(oldest);
        const isExpired = now.getTime() - Date.parse(oldest) >= ONE_YEAR_MS;
        if (!isExpired) continue;
        const shouldMoveNewFlag = gap >= HISTORY_MERGE_MINUTES * 60000 && gap < HISTORY_NEW_MINUTES * 60000;
        if (shouldMoveNewFlag) {
          delete entries[oldest];
          const nextEntry = entries[next];
          if (!!nextEntry && typeof nextEntry === 'object' && 'value' in nextEntry) {
            nextEntry.NEW = true;
          } else {
            entries[next] = { value: nextEntry, NEW: true };
          }
        } else {
          const oldestValue = entries[oldest];
          delete entries[oldest];
          entries[next] = oldestValue;
        }
      }
    }
  }
}

// CSVの先頭行はヘッダーとして扱う。
export function parseStatuses(csv) {
  return csv.split(/\r?\n/).slice(1).map(line => line.trim()).filter(Boolean);
}
export function parseBagcatLabels(csv) {
  const labels = new Map();
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const [code, label] = line.split(',');
    if (!!code && !!label) labels.set(code.trim(), label.trim());
  }
  return labels;
}

// バザーIDごとに複数アイテムをまとめる。
function mergeTrades(bazaarMap, details) {
  for (const detail of details) {
    const trades = detail?.result?.tradeItemList ?? [];
    if (!Array.isArray(trades)) throw new Error('itemDetailのtradeItemListが配列ではありません');
    for (const trade of trades) {
      if (!trade.bazaarId) continue;
      if (!bazaarMap.has(trade.bazaarId)) {
        bazaarMap.set(trade.bazaarId, {
          bazaarId: trade.bazaarId,
          hancoin: trade.hopeItemList?.[0]?.hancoin || null,
          sellEndDate: trade.sellEndDate,
          listingItems: new Set(),
        });
      }
      const entry = bazaarMap.get(trade.bazaarId);
      for (const item of trade.listingItemList ?? []) {
        if (!!item.itemCode) entry.listingItems.add(item.itemCode);
      }
    }
  }
}

// 表示画面で利用する配列形式に変換する。
function toBazaarList(bazaarMap) {
  return Array.from(bazaarMap.values(), entry => ({
    bazaarId: entry.bazaarId,
    hancoin: entry.hancoin,
    sellEndDate: entry.sellEndDate,
    listingItems: Array.from(entry.listingItems),
  }));
}

// 性別情報を一覧の実データから特定する。
function extractGender(detail, code) {
  let gender = null;
  for (const trade of detail.result.tradeItemList ?? []) {
    for (const item of trade.listingItemList ?? []) {
      if (item.itemCode === code && !!item.itemGender) gender = item.itemGender;
    }
  }
  return gender;
}
function canUseGender(itemGender, targetGender) {
  if (itemGender === 'M') return targetGender === 'M';
  if (itemGender === 'F') return targetGender === 'F';
  return true;
}

// 登録アイテムの性能別・部位別の最安値を算出する。
function buildLowestPriceMaps(bazaarList, schema, statuses, labels) {
  const lowestMale = {};
  const lowestFemale = {};
  const schemaByCode = new Map(schema.map(item => [item.itemCode, item]));
  for (const status of statuses) {
    lowestMale[status] = {};
    lowestFemale[status] = {};
  }
  for (const bazaar of bazaarList) {
    const price = Number(bazaar.hancoin);
    if (!Number.isFinite(price) || price <= 0) continue;
    for (const code of bazaar.listingItems) {
      const item = schemaByCode.get(code);
      const match = item?.itemName?.match(/【([A-Z]+)\+(\d+)(?:％|%)?】/);
      if (!match) continue;
      const [, stat, parameter] = match;
      const part = labels.get(item.parts) || 'その他';
      for (const [gender, prices] of [['M', lowestMale], ['F', lowestFemale]]) {
        if (!canUseGender(item.itemGender, gender)) continue;
        const statPrices = prices[stat];
        if (!statPrices) continue;
        statPrices[parameter] ||= {};
        const current = statPrices[parameter][part];
        if (!current || price < current) statPrices[parameter][part] = price;
      }
    }
  }
  return { lowestMale, lowestFemale };
}

// すべての関連アイテムの詳細取得が成功した場合だけ結果を返す。
export async function collectBazaarData({
  schema, statusesCsv, labelsCsv, maleHistory, femaleHistory,
  tradeData, loadDetail, concurrency = 10, now = new Date(),
}) {
  const trades = tradeData?.result?.itemList;
  if (!Array.isArray(trades) || !trades.length) throw new Error('itemtradeのitemListが空または不正です');
  if (!Array.isArray(schema) || !schema.length) throw new Error('itemCodeSchemaが空または不正です');
  const timestamp = tradeData.serverTime;
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error('itemtradeのserverTimeが不正です');
  const codes = new Set(schema.map(item => item.itemCode));
  const initialCodes = Array.from(new Set(trades
    .filter(item => !!item.itemCode && codes.has(item.itemCode))
    .map(item => item.itemCode)));
  if (!initialCodes.length) throw new Error('既知のアイテムが1件も見つかりません');
  const cache = new Map();
  async function fetchDetail(code) {
    if (!cache.has(code)) cache.set(code, loadDetail(code));
    return cache.get(code);
  }
  const bazaarMap = new Map();
  const initialDetails = await mapWithConcurrency(initialCodes, concurrency, fetchDetail);
  mergeTrades(bazaarMap, initialDetails);
  const additionalCodes = new Set();
  const checkedCodes = new Set();
  for (let round = 0; round < MAX_DISCOVERY_ROUNDS; round++) {
    const listingCodes = new Set();
    for (const bazaar of bazaarMap.values()) {
      for (const code of bazaar.listingItems) listingCodes.add(code);
    }
    const candidates = Array.from(listingCodes).filter(code => !codes.has(code) && !checkedCodes.has(code));
    if (!candidates.length) break;
    const details = await mapWithConcurrency(candidates, concurrency, fetchDetail);
    const searchDetails = [];
    for (let index = 0; index < candidates.length; index++) {
      const code = candidates[index];
      const detail = details[index];
      checkedCodes.add(code);
      const itemInfo = detail?.result?.itemInfo;
      if (!itemInfo?.itemName) throw new Error('不明アイテムの詳細がありません: ' + code);
      if (itemInfo.itemName.includes('+')) {
        schema.push({
          itemCode: code,
          itemName: itemInfo.itemName,
          parts: itemInfo.bagcat,
          itemGender: extractGender(detail, code),
        });
        codes.add(code);
        searchDetails.push(detail);
      } else {
        additionalCodes.add(code);
      }
    }
    if (!searchDetails.length) break;
    mergeTrades(bazaarMap, searchDetails);
    if (round === MAX_DISCOVERY_ROUNDS - 1) throw new Error('関連アイテムの探索が上限に達しました');
  }
  const additionalItems = [];
  for (const code of additionalCodes) {
    const detail = await fetchDetail(code);
    additionalItems.push({
      itemCode: code,
      itemName: detail.result.itemInfo.itemName,
      parts: detail.result.itemInfo.bagcat,
      itemGender: extractGender(detail, code),
    });
  }
  const bazaarList = toBazaarList(bazaarMap);
  if (!bazaarList.length) throw new Error('バザーデータが空です');
  const statuses = parseStatuses(statusesCsv);
  if (!statuses.length) throw new Error('type_options.csvが空です');
  const labels = parseBagcatLabels(labelsCsv);
  const { lowestMale, lowestFemale } = buildLowestPriceMaps(bazaarList, schema, statuses, labels);
  mergeAndCleanHistory(lowestMale, maleHistory, timestamp, now);
  mergeAndCleanHistory(lowestFemale, femaleHistory, timestamp, now);
  return {
    'bazzarList.json': bazaarList,
    'itemAnother.json': additionalItems,
    'itemCodeSchema.json': schema,
    'malebuzzerHistory.json': maleHistory,
    'femalebuzzerHistory.json': femaleHistory,
  };
}
