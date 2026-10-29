/**
 * Puretomo 差分取得。
 * 一覧 API は毎回取得するが、詳細 API は変更検出 + 古い順の巡回に限定する。
 * API の一覧に更新日時がないため listingCount のみでは完全な変更検知はできない。
 */
import { buildLowestPriceMaps, mergeAndCleanHistory, parseStatuses, parseBagcatLabels } from './bazaar-core.mjs';

export const REQUEST_LIMIT = 15;
export const REQUEST_GAP_MS = 1200;
export const RECHECK_MS = 4 * 60 * 60 * 1000;
const STAT_PATTERN = /^【[^+】]+\+[^】]+】/;
const STAT_VALUE_PATTERN = /^【([A-Z]+)\+(\d+)(?:％|%)?】/;

export function compactDetail(raw) {
  const result = raw?.result;
  if (!result || !Array.isArray(result.tradeItemList) || !result.itemInfo?.itemName) {
    throw new Error('APIの詳細データが不正です');
  }
  return {
    itemInfo: {
      itemName: result.itemInfo.itemName,
      bagcat: result.itemInfo.bagcat || '',
      itemGender: result.itemInfo.itemGender || null,
    },
    tradeItemList: result.tradeItemList.map(trade => ({
      bazaarId: trade.bazaarId,
      hancoin: trade.hopeItemList?.[0]?.hancoin ?? null,
      sellEndDate: trade.sellEndDate ?? null,
      listingItems: (trade.listingItemList || []).filter(x => x.itemCode).map(x => ({
        itemCode: x.itemCode,
        itemName: x.itemName || '',
        itemGender: x.itemGender || null,
      })),
    })).filter(x => x.bazaarId),
  };
}

/** キャッシュがまだない初回のみ、公開済みJSONを仮の初期データとして利用。 */
export function seedState(listings, schema, another = []) {
  const lookup = new Map([...schema, ...another].map(x => [x.itemCode, x]));
  const offers = new Map();
  for (const listing of listings) {
    for (const code of listing.listingItems || []) {
      if (!offers.has(code)) offers.set(code, []);
      offers.get(code).push({
        bazaarId: listing.bazaarId,
        hancoin: listing.hancoin,
        sellEndDate: listing.sellEndDate,
        listingItems: (listing.listingItems || []).map(c => ({
          itemCode: c,
          itemName: lookup.get(c)?.itemName || '',
          itemGender: lookup.get(c)?.itemGender || null,
        })),
      });
    }
  }
  const entries = {};
  for (const [code, tradeItemList] of offers.entries()) {
    const item = lookup.get(code);
    entries[code] = {
      listingCount: tradeItemList.length,
      checkedAt: 0,
      detail: {
        itemInfo: { itemName: item?.itemName || '', bagcat: item?.parts || '', itemGender: item?.itemGender || null },
        tradeItemList,
      },
    };
  }
  return { version: 1, entries };
}

/** 実行1回の詳細問い合わせ対象。件数変化を優先し、一定数を巡回確認へ確保する。 */
export function chooseDetails(rows, entries, nowMs, limit = REQUEST_LIMIT) {
  const changed = [], stale = [];
  for (const row of rows) {
    const entry = entries[row.itemCode];
    if (!entry || Number(entry.listingCount) !== Number(row.listingCount)) {
      changed.push({ row, last: entry?.checkedAt || 0 });
    } else if (nowMs - Number(entry.checkedAt || 0) >= RECHECK_MS) {
      stale.push({ row, last: Number(entry.checkedAt || 0) });
    }
  }
  // 初めて詳細を取得するアイテムを優先する。複合効果は複数の
  // 検索カテゴリに関わるため、初回取り込み対象をさらに先にする。
  // すでに詳細があるアイテムの件数変化も引き続き検知する。
  const unseen = entry => !entries[entry.row.itemCode]?.detail;
  const compound = entry => /^【[^+】]*[／/][^+】]*\+[^】]+】/.test(entry.row.itemName || '');
  const order = (a,b) => a.last - b.last || b.row.listingCount - a.row.listingCount || a.row.itemCode.localeCompare(b.row.itemCode);
  changed.sort((a,b) =>
    Number(unseen(b)) - Number(unseen(a)) ||
    Number(compound(b)) - Number(compound(a)) ||
    order(a,b));
  stale.sort(order);
  const reserve = stale.length ? Math.min(3, Math.max(0, Math.floor(limit * 0.4))) : 0;
  const selected = changed.splice(0, Math.max(0,limit - reserve));
  selected.push(...stale.splice(0,limit - selected.length));
  selected.push(...changed.splice(0,limit - selected.length));
  return selected.map(x => x.row);
}

function parseEnd(dateString) {
  if (!dateString) return NaN;
  const match = String(dateString).match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (!match) return NaN;
  const [,y,m,d,h,min] = match;
  return Date.parse(y + '-' + m.padStart(2,'0') + '-' + d.padStart(2,'0') + 'T' + h.padStart(2,'0') + ':' + min + ':00+09:00');
}

export async function collectIncrementalBazaarData({
  schema, another = [], previousListings = [], statusesCsv, labelsCsv,
  maleHistory, femaleHistory, tradeData, cacheState,
  loadDetail, now = new Date(), requestLimit = REQUEST_LIMIT,
  requestGapMs = REQUEST_GAP_MS, wait = ms => new Promise(resolve => setTimeout(resolve,ms)),
}) {
  if (!Array.isArray(tradeData?.result?.itemList)) throw new Error('一覧APIのitemListが不正です');
  if (!Number.isFinite(Date.parse(tradeData.serverTime))) throw new Error('一覧APIのserverTimeが不正です');
  const countByCode = new Map();
  const schemaMap = new Map(schema.map(x => [x.itemCode,x]));
  const anotherMap = new Map(another.map(x => [x.itemCode,x]));
  for (const row of tradeData.result.itemList) {
    if (!row?.itemCode) continue;
    const count = Number(row.listingCount || 0);
    if (!Number.isFinite(count) || count < 0) throw new Error('一覧APIの出品数が不正です: ' + row.itemCode);
    if (count <= 0) continue;
    // 詳細APIの対象はステータス付きアイテム。その他のセット品は詳細に含まれる。
    if (!schemaMap.has(row.itemCode) && !STAT_PATTERN.test(row.itemName || '')) continue;
    countByCode.set(row.itemCode, { itemCode: row.itemCode, itemName: row.itemName || schemaMap.get(row.itemCode)?.itemName || '', listingCount: count });
  }
  const rows = [...countByCode.values()];
  const state = cacheState?.version === 1 && cacheState.entries && typeof cacheState.entries === 'object'
    ? cacheState : seedState(previousListings,schema,another);
  const entries = state.entries;
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error('実行日時が不正です');
  const knownBefore = new Set(Object.keys(entries));
  const chosen = chooseDetails(rows,entries,nowMs,requestLimit);
  // 取得の進捗を可視化。特定コードを推測で補完することはしない。
  const uncached = rows.filter(row=>!entries[row.itemCode]?.detail);
  console.log('詳細取得待ち:', JSON.stringify({
    total: uncached.length,
    compound: uncached.filter(row=>/^【[^+】]*[／/][^+】]*\+[^】]+】/.test(row.itemName)).length,
    selected: chosen.filter(row=>!entries[row.itemCode]?.detail).length,
    pendingCodes: uncached.slice(0,5).map(row=>row.itemCode),
  }));
  // キュー内で1件ずつ取得し、リクエスト完了後に待機する（同時通信なし）。
  for (const [index,row] of chosen.entries()) {
    if (index !== 0) await wait(requestGapMs);
    const raw = await loadDetail(row.itemCode);
    const detail = compactDetail(raw);
    entries[row.itemCode] = { checkedAt: nowMs, listingCount: row.listingCount, detail };
    if (!schemaMap.has(row.itemCode) && STAT_PATTERN.test(detail.itemInfo.itemName)) {
      const next = {
        itemCode:row.itemCode, itemName:detail.itemInfo.itemName,
        parts:detail.itemInfo.bagcat, itemGender:detail.itemInfo.itemGender,
      };
      schema.push(next);
      schemaMap.set(row.itemCode,next);
    }
  }

  // 最新一覧にいないコードのキャッシュは無効化する（売り切れを復活させない）。
  // キャッシュは販売中かつステータス対象のコードだけを保持する。
  for(const code of Object.keys(entries)) {
    if(!countByCode.has(code)) delete entries[code];
  }

  const bazaarMap = new Map();
  const activeExtra = new Map();
  for (const row of rows) {
    const detail = entries[row.itemCode]?.detail;
    if (!detail) continue;
    for (const trade of detail.tradeItemList || []) {
      if (Number.isFinite(parseEnd(trade.sellEndDate)) && parseEnd(trade.sellEndDate) <= nowMs) continue;
      const previous = bazaarMap.get(trade.bazaarId);
      const checkedAt = entries[row.itemCode].checkedAt;
      if (!previous) {
        bazaarMap.set(trade.bazaarId,{
          bazaarId:trade.bazaarId, hancoin:trade.hancoin,
          sellEndDate:trade.sellEndDate, checkedAt, listingItems:new Set(),
        });
      }
      const entry = bazaarMap.get(trade.bazaarId);
      if (checkedAt >= entry.checkedAt) {
        entry.hancoin = trade.hancoin;
        entry.sellEndDate = trade.sellEndDate;
        entry.checkedAt = checkedAt;
      }
      for (const item of trade.listingItems || []) {
        entry.listingItems.add(item.itemCode);
        if (!schemaMap.has(item.itemCode) && !anotherMap.has(item.itemCode) && item.itemName) {
          activeExtra.set(item.itemCode,{
            itemCode:item.itemCode, itemName:item.itemName,
            parts:'',itemGender:item.itemGender,
          });
        }
      }
    }
  }

  const bazzarList = [...bazaarMap.values()].map(({bazaarId,hancoin,sellEndDate,listingItems}) => ({
    bazaarId,hancoin,sellEndDate,listingItems:[...listingItems],
  }));
  if (!bazzarList.length && rows.length && previousListings.length) {
    throw new Error('取得結果が0件です。既存データ保護のため更新を中止します');
  }
  const usedCodes = new Set(bazzarList.flatMap(x => x.listingItems));
  const itemAnother = [...anotherMap.values(),...activeExtra.values()].filter(x => usedCodes.has(x.itemCode));
  const statuses = parseStatuses(statusesCsv);
  const labels = parseBagcatLabels(labelsCsv);
  const {lowestMale,lowestFemale} = buildLowestPriceMaps(bazzarList,schema,statuses,labels);
  mergeAndCleanHistory(lowestMale,maleHistory,tradeData.serverTime,now);
  mergeAndCleanHistory(lowestFemale,femaleHistory,tradeData.serverTime,now);

  const checked = chosen.length;
  return {
    data:{
      'bazzarList.json':bazzarList,
      'itemAnother.json':itemAnother,
      'itemCodeSchema.json':schema,
      'malebuzzerHistory.json':maleHistory,
      'femalebuzzerHistory.json':femaleHistory,
      'update-status.json':{
        'fetched-at':now.toISOString(),
        'server-time':tradeData.serverTime,
        'listing-count':bazzarList.length,
        'scanned-code-count':rows.length,
        'new-code-count':chosen.filter(x => !knownBefore.has(x.itemCode)).length,
        'schema-code-count':schema.length,
        'detail-request-count':checked,
        'detail-request-limit':requestLimit,
        'recheck-hours':RECHECK_MS/3600000,
        'api-request-gap-ms':requestGapMs,
      },
    },
    cacheState:state,
    statistics:{listRows:rows.length,detailRequests:checked,cacheHits:rows.filter(x=>entries[x.itemCode]).length - checked},
  };
}
