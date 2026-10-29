import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import test from 'node:test';
import { hasStatTag, parseStatEffects, statTag } from '../stat-effects.mjs';

const read=p=>readFile(new URL('../../'+p,import.meta.url),'utf8');
const [html,script,aliases,css]=await Promise.all([
  read('index.html'),read('owned-gallery.js'),read('stat-alias-candidates.json').then(JSON.parse),read('simple.css'),
]);

test('画像と名前つきの全所持品欄があり、有効なJavaScriptになっている',()=>{
  assert.doesNotThrow(()=>new Script(script));
  assert.match(html,/id="ownedGallery"/);
  assert.match(html,/id="ownedGalleryCount"/);
  assert.match(html,/src="owned-gallery\.js"/);
  assert.match(script,/closetOwnedItems/);
  assert.match(script,/puretomo-image\.hange\.jp\/disp\//);
  assert.match(css,/\.owned-gallery-card/);
});

test('略称の候補一覧を実在マスターから作成',()=>{
  for(const key of ['P/I','P/L','V/L','S/L','AT/DF']){
    const entry=aliases.find(row=>row.alias===key);
    assert.ok(entry,'Missing '+key);
    assert.ok(entry.count>=1);
    assert.ok(entry.examples.length>=1);
    assert.equal(entry.reviewed,false);
  }
});

test('未知の効果名もマスター収集対象',()=>{
  assert.equal(hasStatTag('【未知効果+12】テスト'),true);
  assert.equal(hasStatTag('【AT／DF+10】案内嬢プリム'),true);
  assert.equal(statTag('【P／L+2】ノクスフェイス').alias,'P/L');
  assert.deepEqual(parseStatEffects('【P／L+2】ノクスフェイス'),[
    {type:'POW',value:2},{type:'LUK',value:2},
  ]);
  assert.deepEqual(parseStatEffects('【AT／DF+10】案内嬢プリム'),[
    {type:'ATK',value:10},{type:'DEF',value:10},
  ]);
});
