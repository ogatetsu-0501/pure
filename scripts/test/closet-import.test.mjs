import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import test from 'node:test';

const script=await readFile(new URL('../../closet-import.js',import.meta.url),'utf8');
const html=await readFile(new URL('../../index.html',import.meta.url),'utf8');
const start=script.indexOf('  function normalizeItems(');
const end=script.indexOf('\n  async function importCloset(',start);
assert.ok(start>=0&&end>start);
const normalizeItems=new Function(script.slice(start,end)+'\nreturn normalizeItems;')();

test('クローゼット取り込みのJavaScriptが有効',()=>{
  assert.doesNotThrow(()=>new Script(script));
});
test('APIのitemListから必要な項目だけを抽出',()=>{
  const raw={result:{itemList:[{
    itemCode:'AA123',itemName:'【INT+5】見本',bagcat:'AA',itemGender:'A',
    sessionToken:'DONOTSTORE',memberId:'SECRET',metadata:{private:true},
  }]}};
  assert.deepEqual(normalizeItems(raw),[{
    itemCode:'AA123',itemName:'【INT+5】見本',bagcat:'AA',itemGender:'A',
  }]);
  assert.equal(JSON.stringify(normalizeItems(raw)).includes('SECRET'),false);
});
test('不正なレスポンスと過大データを拒否する',()=>{
  assert.throws(()=>normalizeItems({result:{}}),/形式/);
  assert.throws(()=>normalizeItems(Array.from({length:10001},()=>({itemCode:'a'}))),/形式/);
});
test('所持一覧の取り込みUIとブックマークレットを公開',()=>{
  assert.match(html,/id="closetJsonInput"/);
  assert.match(html,/id="closetBookmarklet"/);
  assert.match(html,/id="copyClosetBookmarklet"/);
  assert.match(html,/<script src="closet-import\.js" defer><\/script>/);
  assert.match(script,/event\.origin !== BRIDGE_ORIGIN/);
  assert.match(script,/credentials:'include'/);
});

test('スマホChrome向けブックマークURLは実行可能な1行のJavaScript',()=>{
  const start=script.indexOf('  function closetBookmarklet()');
  const end=script.indexOf('\n  async function received(',start);
  assert.ok(start>=0&&end>start);
  const source=script.slice(start,end);
  const getFn=new Function(source+'\nreturn closetBookmarklet;');
  const fn=getFn();
  const bookmarkletCode=fn.toString().replace(/^\s*\/\/.*$/gm,'').replace(/\s*\n\s*/g,' ');
  const url='javascript:('+bookmarkletCode+')()';
  assert.doesNotThrow(()=>new Script(url.slice('javascript:'.length)));
  assert.equal(url.includes('\n'),false);
  assert.match(url,/bagcat=ALL&page=/);
  assert.doesNotMatch(url,/closet=S/);
});

test('マスターの部位をJSONより優先し、LDの下衣装をボトムスとして判定',async()=>{
  const csv=await readFile(new URL('../../bagcat_labels.csv',import.meta.url),'utf8');
  const labels=new Map(csv.trim().split(/\r?\n/).slice(1).map(line=>line.split(',')));
  assert.equal(labels.get('LD'),'ボトムス');
  const schema=JSON.parse(await readFile(new URL('../../itemCodeSchema.json',import.meta.url),'utf8'));
  const item=schema.find(x=>x.itemCode==='LD119JI');
  assert.equal(item.parts,'L');
  assert.equal(labels.get(item.parts),'ボトムス');
  assert.match(script,/const bagcat = known\?\.parts \|\| item\.bagcat \|\| '';/);
});

test('全所持品のページ数と総件数を確認し、欠落や重複を拒否する',()=>{
  assert.match(script,/Number\(first\.maxCount\)/);
  assert.match(script,/Number\(result\.currentPage\)!==page/);
  assert.match(script,/seen\.has\(String\(item\.seq\)\)/);
  assert.match(script,/items\.length!==maxCount/);
  assert.match(script,/1200/);
});
