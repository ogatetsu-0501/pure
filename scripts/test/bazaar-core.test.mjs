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


// 以前のマスターに存在しない2026年のアバターだけでも、取得漏れを防ぎます。
test('新作アバターだけのバザーも取得できる', async () => {
  const detail = {
    result: {
      itemInfo: { itemName: '【INT+5】2026年新作', bagcat: 'WA' },
      tradeItemList: [{ bazaarId: 'sale-new', hopeItemList: [{ hancoin: 600 }],
        sellEndDate: '2026/11/01 12:00',
        listingItemList: [{ itemCode: 'NEW2026', itemGender: 'A' }] }],
    },
  };
  const result = await collectBazaarData({
    schema: [{ itemCode: 'OLD', itemName: '【POW+3】旧商品', parts: 'WA', itemGender: 'M' }],
    statusesCsv: 'type\nPOW\nINT\n',
    labelsCsv: 'code,label\nWA,武器\n',
    maleHistory: {}, femaleHistory: {},
    tradeData: { serverTime: '2026-10-29T12:00:00.000Z', result: { itemList: [{ itemCode: 'NEW2026' }] } },
    loadDetail: async () => detail,
    now: new Date('2026-10-29T12:00:00.000Z'),
  });
  assert.equal(result['bazzarList.json'].length, 1);
  assert.equal(result['itemCodeSchema.json'].at(-1).itemCode, 'NEW2026');
  assert.equal(result['update-status.json']['new-code-count'], 1);
});
