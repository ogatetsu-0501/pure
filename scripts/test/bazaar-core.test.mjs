// バザー集計の基本動作と異常系を検証します。
import assert from 'node:assert/strict';
import test from 'node:test';
import { mapWithConcurrency, mergeAndCleanHistory, parseStatuses, parseBagcatLabels, collectBazaarData } from '../bazaar-core.mjs';

test('CSVのヘッダーを除き、部位名を抽出する', () => {
  assert.deepEqual(parseStatuses('type\nHP\nSP\n'), ['HP','SP']);
  assert.equal(parseBagcatLabels('code,label\nAA,頭\n').get('AA'), '頭');
});

test('並列取得の結果順を保持する', async () => {
  const result = await mapWithConcurrency([3,1,2], 2, async value => value * 2);
  assert.deepEqual(result, [6,2,4]);
});

test('履歴初回はNEWフラグ付きで保存する', () => {
  const history = {};
  mergeAndCleanHistory({ HP: { '1': { '頭': 10 } } }, history, '2026-10-29T00:00:00Z');
  assert.deepEqual(history.HP['1']['頭']['2026-10-29T00:00:00Z'], { value: 10, NEW: true });
});

test('取得結果が不正なら更新を拒否する', async () => {
  await assert.rejects(collectBazaarData({schema:[],tradeData:{result:{itemList:[]}}}), /itemList/);
});

test('一覧取得と関連データを集計する', async () => {
  const tradeData={serverTime:'2026-10-29T00:00:00Z',result:{itemList:[{itemCode:'a'}]}};
  const detail={result:{itemInfo:{itemName:'A',bagcat:'AA'},tradeItemList:[{bazaarId:'id-1',hopeItemList:[{hancoin:100}],listingItemList:[{itemCode:'a'}]}]}};
  const r=await collectBazaarData({schema:[{itemCode:'a',itemName:'【HP+1】 A',parts:'AA',itemGender:'M'}],statusesCsv:'type\nHP\n',labelsCsv:'code,label\nAA,頭\n',maleHistory:{},femaleHistory:{},tradeData,loadDetail:async()=>detail});
  assert.equal(r['bazzarList.json'][0].bazaarId,'id-1');
  assert.equal(r['malebuzzerHistory.json'].HP['1']['頭']['2026-10-29T00:00:00Z'].value,100);
});
