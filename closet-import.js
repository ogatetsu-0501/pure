/* Puretomo クローゼット取り込み（試験版）
 * 公式クローゼットへのログインはユーザー自身が行う。
 * 認証情報を受け渡さず、所持アバターの itemCode / itemName / bagcat だけをローカルに取り込む。
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const BRIDGE_ORIGIN = 'https://puretomo.hange.jp';

  function normalizeItems(value) {
    const source = Array.isArray(value) ? value
      : Array.isArray(value?.items) ? value.items
      : Array.isArray(value?.result?.itemList) ? value.result.itemList
      : null;
    if (!source || source.length > 10000) throw Error('アイテム一覧の形式または件数が不正です');
    return source.filter(item => item && typeof item === 'object')
      .map(item => ({
        itemCode: String(item.itemCode ?? item.code ?? '').slice(0,80),
        itemName: String(item.itemName ?? item.name ?? '').slice(0,250),
        bagcat: String(item.bagcat ?? item.parts ?? '').slice(0,50),
        itemGender: String(item.itemGender ?? '').slice(0,5),
      })).filter(item => item.itemCode);
  }


  async function importCloset(source, method) {
    const status = $('closetImportStatus');
    const items = normalizeItems(source);
    if (!items.length) throw Error('取り込み可能なアバターが見つかりません');
    const [schemaRes, labelsRes] = await Promise.all([
      fetch('itemCodeSchema.json'), fetch('bagcat_labels.csv'),
    ]);
    if (!schemaRes.ok || !labelsRes.ok) throw Error('アバターマスターを取得できませんでした');
    const schema = await schemaRes.json();
    const labelsText = await labelsRes.text();
    const byCode = new Map(schema.map(item => [item.itemCode,item]));
    const names = new Map(labelsText.split(/\r?\n/).slice(1)
      .map(row => row.split(',').map(v => v.trim())).filter(row => row.length >= 2));
    let existing;
    try { existing = JSON.parse(localStorage.getItem('avatarList') || '[]'); } catch { existing=[]; }
    if(!Array.isArray(existing)) existing = [];
    const updates = new Map();
    let unresolved=0, nonStatus=0;
    for(const item of items) {
      const known = byCode.get(item.itemCode);
      const name = item.itemName || known?.itemName || '';
      const bagcat = item.bagcat || known?.parts || '';
      const part = names.get(bagcat) || (known?.parts ? names.get(known.parts) : '') || '';
      const matches = [...name.matchAll(/【([A-Z]+)\+(\d+)(?:%|％)?】/g)];
      if(!matches.length) { nonStatus++; continue; }
      if(!part) { unresolved++; continue; }
      for(const match of matches) {
        const type = match[1], increase = Number(match[2]);
        if(!Number.isFinite(increase) || increase <= 0) continue;
        const key = part + '|' + type;
        const old = updates.get(key);
        if(!old || increase > old.increase) updates.set(key,{part,type,increase});
      }
    }
    if(!updates.size) {
      throw Error('登録できるステータス付きアバターがありません。取得データの形式やマスターを確認してください');
    }
    let changes=0;
    const additions=[];
    for(const item of updates.values()) {
      const maxOwned = existing.filter(row => row.partText === item.part &&
        (row.type1 === item.type || row.type2 === item.type))
        .reduce((max,row) => Math.max(max,Number(row.increase)||0),0);
      if(maxOwned >= item.increase) continue;
      additions.push(item);
    }
    if(!additions.length) {
      status.textContent = '所持アバター '+items.length+'点を照合しました。更新が必要なステータスはありません。';
      return {items:items.length,changes:0};
    }
    if (!window.confirm(
      'クローゼットの '+items.length+' 件を確認し、所持最大値を '+additions.length+
      ' 件更新します。\n既存の登録は保持されます。続行しますか？'
    )) return {items:items.length,changes:0,cancelled:true};
    for(const item of additions) {
      const index=existing.findIndex(row => row.partText === item.part &&
        row.type1 === item.type && (!row.type2 || row.type2 === 'なし'));
      const record={
        partText:item.part, type1:item.type, type2:'なし',
        increase:String(item.increase),registeredAt:new Date().toISOString(),
      };
      if(index>=0) existing[index]=record; else existing.push(record);
      changes++;
    }
    localStorage.setItem('avatarList', JSON.stringify(existing));
    window.dispatchEvent(new Event('puretomo:owned-changed'));
    window.refreshOriginalOwned?.();
    status.textContent = method+'：'+items.length+'点を確認、'+changes+
      '件の所持最大値を更新しました。'+
      (nonStatus?'（ステータス対象外 '+nonStatus+'件）':'')+
      (unresolved?'（部位不明 '+unresolved+'件）':'');
    return {items:items.length,changes};
  }

  // ブックマークレット本体はログイン済みのクローゼットで実行される。
  // CORSによりGitHub Pagesから直接読めないため、ユーザー操作で公式サイト上で動作させる。
  function closetBookmarklet() {
    (async () => {
      if (location.origin !== 'https://puretomo.hange.jp' ||
          !location.pathname.startsWith('/closet')) {
        alert('公式Puretomoのクローゼット画面で実行してください。');
        return;
      }
      const targetOrigin='https://ogatetsu-0501.github.io';
      const target=window.open(targetOrigin+'/pure/#closet-import', 'puretomo-closet-sync');
      let pages=0,items=[];
      try {
        // 公式クローゼットが使う一覧API。ALLは正規のbagcat値と確認できないため使わない。
        // closet=S は公式フロントエンドの「ALL」画面で利用されている。
        const api='https://puretomo-ap.hange.jp/api/closet/itembag.json?closet=S&page=';
        const load=async page=>{
          const response=await fetch(api+page,{credentials:'include',headers:{Accept:'application/json'}});
          if(!response.ok) throw Error('クローゼットAPI HTTP '+response.status+'。ログイン・Cookie・API通信が制限されている可能性があります');
          const payload=await response.json();
          if(payload.status && payload.status !== 'SUCCESS') throw Error('クローゼットAPI: '+payload.status);
          if(!Array.isArray(payload.result?.itemList)) throw Error('所持一覧の形式を確認できません（itemList不在）');
          return payload.result;
        };
        const first=await load(1);
        const maxPage=Math.max(1,Number(first.maxPage)||1);
        if(maxPage>250)throw Error('ページ数が250を超えました。安全のため停止します');
        items.push(...first.itemList);pages++;
        for(let page=2;page<=maxPage;page++){
          await new Promise(resolve=>setTimeout(resolve,1000));
          const next=await load(page);
          items.push(...next.itemList); pages++;
        }
        const sanitized=items.map(item=>({
          itemCode:String(item.itemCode||item.code||'').slice(0,80),
          itemName:String(item.itemName||item.name||'').slice(0,250),
          bagcat:String(item.bagcat||'').slice(0,50),
          itemGender:String(item.itemGender||'').slice(0,5),
        })).filter(item=>item.itemCode);
        if(!sanitized.length)throw Error('所持アバターが取得できませんでした（全ページにitemCodeがありません）');
        const data={type:'puretomo:closet-data',version:1,items:sanitized};
        let acked=false;
        const ack=event=>{
          if(event.origin===targetOrigin && event.data?.type==='puretomo:closet-received') acked=true;
        };
        window.addEventListener('message',ack);
        for(let retry=0;retry<12&&!acked;retry++){
          target?.postMessage(data,targetOrigin);
          await new Promise(resolve=>setTimeout(resolve,650));
        }
        window.removeEventListener('message',ack);
        if(!acked) {
          const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
          const a=document.createElement('a'),url=URL.createObjectURL(blob);
          a.href=url;a.download='puretomo-closet-'+new Date().toISOString().slice(0,10)+'.json';
          document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
          alert('ブラウザ内で '+sanitized.length+' 点を取得しました。\nJSONをダウンロードしたので、Puretomoの所持一覧から読み込んでください。');
        }
      }catch(error) {
        alert('クローゼットの取り込みに失敗しました：'+error.message+
          '\nログイン済みか、クローゼットの「ALL」が表示されているか確認してください。');
      }
    })();
  }

  async function received(event) {
    if (event.origin !== BRIDGE_ORIGIN || event.data?.type !== 'puretomo:closet-data' || event.data.version !== 1) return;
    event.source?.postMessage({type:'puretomo:closet-received'},event.origin);
    window.openPuretomoOwned?.();
    try {
      await importCloset(event.data,'クローゼット連携');
    }catch(error){
      $('closetImportStatus').textContent='取り込みエラー: '+error.message;
    }
  }

  document.addEventListener('DOMContentLoaded',()=>{
    const link=$('closetBookmarklet');
    // ブラウザのブックマークバーにドラッグして登録する用途。
    link.href='javascript:('+closetBookmarklet.toString()+')()';
    $('copyClosetBookmarklet').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(link.href);
        $('closetImportStatus').textContent='ブックマーク用URLをコピーしました。公式クローゼットで使うブックマークに設定してください。';
      } catch (error) {
        $('closetImportStatus').textContent='自動コピーできませんでした。PCではリンクをブックマークバーへドラッグしてください。';
      }
    });
    $('closetJsonInput').addEventListener('change',async event=>{
      const file=event.target.files?.[0];
      if(!file) return;
      try {
        if(file.size>8*1024*1024)throw Error('8MBを超えるファイルは読み込めません');
        const data=JSON.parse(await file.text());
        await importCloset(data,'JSON取り込み');
      }catch(error){
        $('closetImportStatus').textContent='取り込みエラー: '+error.message;
      }finally{event.target.value='';}
    });
    window.addEventListener('message',received);
  });
})();
