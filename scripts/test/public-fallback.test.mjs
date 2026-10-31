// 公開APIが正常なら、男性用API障害時でも更新を続ける統合テスト。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runUpdate } from '../update-bazaar.mjs';

const response = {status:'SUCCESS',serverTime:'2026-10-31T12:00:00.000Z',result:{
  itemList:[{itemCode:'PUBLIC',itemName:'【INT+5】公開',listingCount:1}],
}};
const sampleDetail = {result:{
  itemInfo:{itemName:'【INT+5】公開',bagcat:'AA',itemGender:'F'},
  tradeItemList:[{bazaarId:'bazaar-1',sellEndDate:'2026/11/05 12:00',
    hopeItemList:[{hancoin:200}],listingItemList:[{itemCode:'PUBLIC',itemName:'【INT+5】公開',itemGender:'F'}]}],
}};

async function withData(testBody) {
  const dir=await mkdtemp(path.join(tmpdir(),'pure-public-fallback-'));
  const inputs={
    'itemCodeSchema.json':[{itemCode:'PUBLIC',itemName:'【INT+5】公開',parts:'AA',itemGender:'F'}],
    'itemAnother.json':[],
    'bazzarList.json':[],
    'malebuzzerHistory.json':{},
    'femalebuzzerHistory.json':{},
    'type_options.csv':'type\nINT\n',
    'bagcat_labels.csv':'code,label\nAA,アクセ\n',
    'update-status.json':{},
  };
  try {
    await mkdir(path.join(dir,'.cache'),{recursive:true});
    for (const [file,value] of Object.entries(inputs)) {
      const text=typeof value==='string'?value:JSON.stringify(value);
      await writeFile(path.join(dir,file),text,'utf8');
    }
    await testBody(dir);
  } finally {
    await rm(dir,{recursive:true,force:true});
  }
}

test('男性用認証が401でも非ログインデータを保存する',async()=>{
  await withData(async dir=>{
    const result=await runUpdate({
      dataRoot:dir,now:new Date('2026-10-31T12:00:00Z'),
      loadTrade:async()=>response,
      loadMaleTrade:async()=>{throw Error('HTTP 401');},
      loadDetail:async()=>sampleDetail,
    });
    assert.equal(result['update-status.json']['male-api-mode'],'public-only');
    assert.equal(result['bazzarList.json'].length,1);
    const saved=JSON.parse(await readFile(path.join(dir,'bazzarList.json'),'utf8'));
    assert.equal(saved[0].bazaarId,'bazaar-1');
  });
});

test('公開APIの失敗では更新せず旧データを保護する',async()=>{
  await withData(async dir=>{
    await assert.rejects(runUpdate({
      dataRoot:dir,loadTrade:async()=>{throw Error('公開HTTP 503');},
      loadMaleTrade:async()=>response,
      loadDetail:async()=>sampleDetail,
    }),/公開HTTP 503/);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir,'bazzarList.json'),'utf8')),[]);
  });
});

test('認証済みなら男性用一覧を統合して従来どおり更新する',async()=>{
  await withData(async dir=>{
    const male={status:'SUCCESS',serverTime:response.serverTime,result:{
      itemList:[{itemCode:'PUBLIC',itemName:'【INT+5】公開',listingCount:1}],
      maxCount:1,
    }};
    const result=await runUpdate({
      dataRoot:dir,now:new Date('2026-10-31T12:00:00Z'),
      loadTrade:async()=>response,
      loadMaleTrade:async()=>male,
      loadDetail:async()=>sampleDetail,
    });
    assert.equal(result['update-status.json']['male-api-mode'],'full');
    assert.equal(result['bazzarList.json'].length,1);
  });
});
