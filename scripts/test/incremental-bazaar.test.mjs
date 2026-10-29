import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseDetails, compactDetail, collectIncrementalBazaarData, REQUEST_GAP_MS } from '../incremental-bazaar.mjs';

const now = new Date('2026-10-29T07:20:00Z');
function avatar(code, count=1) {
  return { itemCode:code, itemName:'【INT+5】' + code, listingCount:count };
}
function detail(code, end='2026/10/31 12:00') {
  return { result:{
    itemInfo:{itemName:'【INT+5】'+code, bagcat:'AA', itemGender:'A'},
    tradeItemList:[{
      bazaarId:'bazaar-'+code,
      sellEndDate:end,
      hopeItemList:[{ hancoin:500 }],
      listingItemList:[{ itemCode:code, itemName:'【INT+5】'+code, itemGender:'A' }],
    }],
  }};
}
function options(overrides={}) {
  return {
    schema:[{itemCode:'OLD',itemName:'【INT+5】OLD',parts:'AA',itemGender:'A'}],
    another:[], previousListings:[],
    statusesCsv:'type\nINT\n', labelsCsv:'code,label\nAA,アクセ1\n',
    maleHistory:{}, femaleHistory:{},
    now,
    tradeData:{serverTime:'2026-10-29T16:20:00', result:{itemList:[avatar('NEW')]}},
    loadDetail:async(code)=>detail(code),
    wait:async()=>{},
    ...overrides,
  };
}
test('APIの詳細から個人情報を除去してキャッシュする',()=>{
  const raw=detail('ABC');
  raw.result.tradeItemList[0].memberId='private-value';
  raw.result.tradeItemList[0].applyUserInfo={some:'private-info'};
  const output=compactDetail(raw);
  assert.equal(JSON.stringify(output).includes('private-value'),false);
  assert.equal(JSON.stringify(output).includes('private-info'),false);
  assert.equal(output.tradeItemList[0].hancoin,500);
});
test('件数変化を優先、古い未変化も巡回する',()=>{
  const rows=Array.from({length:9},(_,i)=>avatar('A'+i,i<6?3:1));
  const entries=Object.fromEntries(rows.map((row,i)=>[row.itemCode,{
    listingCount:1,checkedAt:i<6?now.getTime()-600000:now.getTime()-7*3600000,
  }]));
  const result=chooseDetails(rows,entries,now.getTime(),5);
  assert.equal(result.length,5);
  assert.equal(result.filter(x=>x.itemCode.startsWith('A')&&Number(x.itemCode.slice(1))<6).length,3);
  assert.equal(result.filter(x=>Number(x.itemCode.slice(1))>=6).length,2);
});
test('変化なしで4時間未満なら詳細APIを呼ばない',()=>{
  const rows=[avatar('X',1)];
  const entries={X:{listingCount:1,checkedAt:now.getTime()-60*60000,detail:{}}};
  assert.deepEqual(chooseDetails(rows,entries,now.getTime()),[]);
});
test('4時間経過した変更なしアイテムも再取得',()=>{
  const rows=[avatar('X',1)];
  const entries={X:{listingCount:1,checkedAt:now.getTime()-5*3600000,detail:{}}};
  assert.deepEqual(chooseDetails(rows,entries,now.getTime()).map(x=>x.itemCode),['X']);
});
test('新作しか出品されていなくても取得する', async()=>{
  const result=await collectIncrementalBazaarData(options());
  assert.equal(result.data['bazzarList.json'].length,1);
  assert.equal(result.data['bazzarList.json'][0].listingItems[0],'NEW');
  assert.equal(result.data['itemCodeSchema.json'].at(-1).itemCode,'NEW');
  assert.equal(result.statistics.detailRequests,1);
});
test('2件の詳細取得の間には指定した待機を挟む',async()=>{
  const requests=[], delays=[];
  const result=await collectIncrementalBazaarData(options({
    tradeData:{serverTime:'2026-10-29T16:20:00',result:{itemList:[avatar('NEW'),avatar('Y')]}},
    loadDetail:async(code)=>{requests.push(code);return detail(code)},
    wait:async(ms)=>{delays.push(ms)},
  }));
  assert.deepEqual(requests,['NEW','Y']);
  assert.deepEqual(delays,[REQUEST_GAP_MS]);
  assert.equal(result.statistics.detailRequests,2);
});
test('1回の詳細取得は最大15件',async()=>{
  let calls=0;
  const rows=Array.from({length:50},(_,i)=>avatar('NEW'+i));
  const r=await collectIncrementalBazaarData(options({
    tradeData:{serverTime:'2026-10-29T16:20:00',result:{itemList:rows}},
    loadDetail:async(code)=>{calls++;return detail(code)},
  }));
  assert.equal(calls,15);
  assert.equal(r.data['update-status.json']['detail-request-count'],15);
});
test('最新一覧から消えたアイテムはキャッシュからも除外',async()=>{
  const cached={
    version:1,entries:{
      OLD:{listingCount:1,checkedAt:now.getTime(),detail:compactDetail(detail('OLD'))},
      GONE:{listingCount:1,checkedAt:now.getTime(),detail:compactDetail(detail('GONE'))},
    },
  };
  const r=await collectIncrementalBazaarData(options({
    tradeData:{serverTime:'2026-10-29T16:20:00',result:{itemList:[avatar('OLD')]}},
    cacheState:cached,
    loadDetail:async()=>{throw Error('should not fetch')},
  }));
  assert.equal(Object.hasOwn(r.cacheState.entries,'GONE'),false);
  assert.equal(r.data['bazzarList.json'].length,1);
});
test('詳細APIエラーなら部分更新せず例外を返す',async()=>{
  await assert.rejects(collectIncrementalBazaarData(options({
    loadDetail:async()=>{throw Error('HTTP 503')},
  })),/HTTP 503/);
});

test('未取得の複合ステータスを既取得の変更項目より優先する',()=>{
  const rows=[
    {itemCode:'ORDINARY',itemName:'【HP+5】既存',listingCount:2},
    {itemCode:'COMPOUND',itemName:'【AT／DF+10】複合',listingCount:1},
    {itemCode:'SINGLE',itemName:'【MOV+20】新規',listingCount:1},
  ];
  const entries={ORDINARY:{listingCount:1,checkedAt:now.getTime()-3600000,detail:{itemInfo:{itemName:'【HP+5】既存'},tradeItemList:[]}}};
  assert.deepEqual(chooseDetails(rows,entries,now.getTime(),1).map(row=>row.itemCode),['COMPOUND']);
});
