import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import test from 'node:test';

const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const market = scripts.find(match => match[2].includes('const state = { listings:'));
assert.ok(market, '市場画面のスクリプトが存在する');

test('市場画面のJavaScriptが構文的に正しい', () => {
  assert.doesNotThrow(() => new Script(market[2]));
});

function buildCalculator(owned) {
  const start = market[2].indexOf('  function readOwnedBest()');
  const end = market[2].indexOf('\n  function buildListing(',start);
  assert.ok(start >= 0 && end > start);
  const snippet = market[2].slice(start,end);
  const state = { ownedBest:new Map() };
  const localStorage = { getItem: key => key === 'avatarList' ? JSON.stringify(owned) : null };
  const factory = new Function('state','localStorage',snippet+'\nreturn { readOwnedBest, improvement, totalImprovement, gainPerHC };');
  const c = factory(state,localStorage);
  state.ownedBest = c.readOwnedBest();
  return c;
}

test('所持値との差分の合計をHCで割る（重複ステータスは最大差分だけ）',()=>{
  const c = buildCalculator([
    {partText:'帽子',type1:'INT',type2:'なし',increase:'3'},
    {partText:'服',type1:'POW',type2:'なし',increase:'1'},
  ]);
  const listing = {price:100,items:[
    {part:'帽子',type:'INT',value:5}, // +2
    {part:'帽子',type:'INT',value:4}, // +1 だが同じ部位・種類なので重複させない
    {part:'服',type:'POW',value:3},   // +2
    {part:'服',type:'POW',value:1},   // +0
  ]};
  assert.equal(c.totalImprovement(listing),4);
  assert.equal(c.gainPerHC(listing),.04);
});

test('未所持は0からの上昇、所持値以下・0HCは除外',()=>{
  const c=buildCalculator([{partText:'帽子',type1:'INT',type2:'なし',increase:'10'}]);
  const items=[{part:'帽子',type:'INT',value:5},{part:'服',type:'POW',value:3}];
  assert.equal(c.totalImprovement({items}),3);
  assert.equal(c.gainPerHC({items,price:100}),.03);
  assert.equal(c.gainPerHC({items,price:0}),0);
});

test('費用対効果の降順ソートが選択肢に用意される',()=>{
  assert.match(html, /value="gainPerHC"/);
  assert.match(market[2], /gainPerHC: \(a,b\) => gainPerHC\(b\) - gainPerHC\(a\)/);
  assert.match(market[2], /addEventListener\('puretomo:owned-changed', filterListings\)/);
});
