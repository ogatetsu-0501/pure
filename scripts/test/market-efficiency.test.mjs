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

function buildCalculator(owned, selectedTypes = null) {
  const start = market[2].indexOf('  function readOwnedBest()');
  const end = market[2].indexOf('\n  function buildListing(',start);
  assert.ok(start >= 0 && end > start);
  const snippet = market[2].slice(start,end);
  const state = { ownedBest:new Map(), efficiencyTypes: selectedTypes };
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

test('INTだけを選択するとPOWやVITは加算しない',()=>{
  const owned=[
    {partText:'帽子',type1:'INT',type2:'なし',increase:'2'},
    {partText:'服',type1:'POW',type2:'なし',increase:'1'},
  ];
  const listing={price:100,items:[
    {part:'帽子',type:'INT',value:5},
    {part:'服',type:'POW',value:4},
    {part:'靴',type:'VIT',value:2},
  ]};
  const intOnly=buildCalculator(owned,new Set(['INT']));
  assert.equal(intOnly.totalImprovement(listing),3);
  assert.equal(intOnly.gainPerHC(listing),.03);
});

test('複数パラメータを選ぶと差分を合計して1HCで割る',()=>{
  const owned=[{partText:'帽子',type1:'INT',type2:'なし',increase:'2'}];
  const listing={price:200,items:[
    {part:'帽子',type:'INT',value:6},  // +4
    {part:'服',type:'POW',value:3},    // +3
    {part:'靴',type:'VIT',value:7},    // 未選択
  ]};
  const both=buildCalculator(owned,new Set(['INT','POW']));
  assert.equal(both.totalImprovement(listing),7);
  assert.equal(both.gainPerHC(listing),.035);
  assert.equal(buildCalculator(owned,new Set()).gainPerHC(listing),0);
});

test('複数選択UIは全選択・解除と保存に対応',()=>{
  for (const field of ['efficiencyParameters','efficiencyParameterOptions','efficiencySelectAll','efficiencyClearAll']) {
    assert.match(html,new RegExp('id="'+field+'"'));
  }
  assert.match(market[2],/localStorage\.setItem\('efficiencyParameters'/);
  assert.match(market[2],/state\.efficiencyTypes\s*=\s*new Set/);
});

test('販売一覧からATK DEF MOVを自動抽出し複合タグも分解',()=>{
  const start=market[2].indexOf('  function buildListing(raw, lookup, parts)');
  const end=market[2].indexOf('\n  function updateFilterOptions(',start);
  const snippet=market[2].slice(start,end);
  const fn=new Function('numericPrice','parseDate','numeric',snippet+'\nreturn buildListing;')(
    x=>Number(x.hancoin),()=>0,x=>parseInt(x,10)||0
  );
  const lookup=new Map([
    ['A',{itemName:'【AT／DF+10】例',parts:'FA'}],
    ['B',{itemName:'【MOV+20】例',parts:'AD'}],
  ]);
  const listing=fn({bazaarId:'a',hancoin:100,listingItems:['A','B']},lookup,new Map([['FA','フェイス'],['AD','めがね']]));
  assert.deepEqual(listing.items.map(x=>x.type).sort(),['ATK','DEF','MOV']);
  assert.match(market[2],/items\.flatMap\(row => row\.items\.map\(item => item\.type\)/);
});

test('補助データに同じアイテムがあっても正式マスターの部位を優先',()=>{
  assert.match(market[2],/\[\.\.\.additional,\.\.\.schema\]/);
  const schema=[
    {itemCode:'A11CKW',itemName:'【INT+4】ガオウと一緒',parts:'A1',itemGender:'A'},
    {itemCode:'E41BZP',itemName:'【VIT+4】フォー・ユー',parts:'E4',itemGender:'A'},
  ];
  const additional=schema.map(x=>({...x,parts:''}));
  const lookup=new Map([...additional,...schema].map(x=>[x.itemCode,x]));
  assert.equal(lookup.get('A11CKW').parts,'A1');
  assert.equal(lookup.get('E41BZP').parts,'E4');
});
