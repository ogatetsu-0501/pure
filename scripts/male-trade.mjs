// 男性の認証付き一覧と女性の公開一覧を統合する。
// APIへのアクセスは呼び出し側に任せ、ここではデータの検証と統合だけを行う。
export function mergeTradeLists(publicData, maleData) {
  const publicItems = publicData?.result?.itemList;
  const maleItems = maleData?.result?.itemList;
  if (publicData?.status !== 'SUCCESS' || !Array.isArray(publicItems)) {
    throw new Error('公開一覧APIの応答が不正です');
  }
  if (maleData?.status !== 'SUCCESS' || !Array.isArray(maleItems)) {
    throw new Error('男性一覧APIの応答が不正です');
  }
  if (!maleItems.length) throw new Error('男性一覧が空のため既存データを保護します');
  const expectedCount = Number(maleData.result.maxCount);
  if (!Number.isFinite(expectedCount) || expectedCount > maleItems.length) {
    throw new Error('男性一覧の取得件数が不完全です');
  }
  const rows = new Map();
  for (const item of publicItems) {
    if (!!item?.itemCode) rows.set(item.itemCode, item);
  }
  const maleCodes = new Set();
  for (const item of maleItems) {
    if (!item?.itemCode) throw new Error('男性一覧にアイテムコードの欠損があります');
    maleCodes.add(item.itemCode);
    rows.set(item.itemCode, item);
  }
  const serverTime = publicData.serverTime;
  if (!Number.isFinite(Date.parse(serverTime))) throw new Error('公開一覧のserverTimeが不正です');
  return {
    tradeData: {
      ...publicData,
      result: { ...publicData.result, itemList: [...rows.values()] },
    },
    maleCodes,
  };
}
