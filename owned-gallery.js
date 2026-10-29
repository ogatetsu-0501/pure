/* ローカルにある所持アイテム画像一覧と、複合表記候補を表示。 */
(() => {
  const el=id=>document.getElementById(id);
  const image=(code)=>'https://puretomo-image.hange.jp/disp/'+encodeURIComponent(String(code).toLowerCase())+'.gif';
  const parse=key=>{try{const x=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(x)?x:[];}catch{return[];}};
  function refresh(){
    const items=parse('closetOwnedItems');
    const gallery=el('ownedGallery');
    const count=el('ownedGalleryCount');
    if(!gallery||!count)return;
    count.textContent=items.length+'件の所持アバター（同一コードの複数所持も含む）';
    gallery.replaceChildren();
    for(const item of items) {
      if(!/^[a-z0-9]+$/i.test(item.itemCode))continue;
      const card=document.createElement('div');card.className='owned-gallery-card';
      const img=document.createElement('img');img.src=image(item.itemCode);img.loading='lazy';img.width=65;img.height=65;img.alt='';
      const label=document.createElement('span');label.textContent=item.itemName||item.itemCode;
      card.append(img,label);gallery.append(card);
    }
  }
  async function loadAliases(){
    const box=el('aliasCandidates');
    if(!box)return;
    try{
      const response=await fetch('./stat-alias-candidates.json');
      if(!response.ok)throw Error('候補表を取得できませんでした');
      const rows=await response.json();
      const table=document.createElement('table');
      const head=document.createElement('thead');head.innerHTML='<tr><th>表記</th><th>対応候補（要確認）</th><th>件数・例</th></tr>';
      table.append(head);
      const body=document.createElement('tbody');
      for(const row of rows){
        const tr=document.createElement('tr');
        const a=document.createElement('td');const code=document.createElement('code');code.textContent=row.alias;a.append(code);
        const b=document.createElement('td');b.textContent=row.parameters.length?row.parameters.join(' + '):'未判定';
        const c=document.createElement('td');c.textContent=row.count+'件 / '+(row.examples?.[0]?.name||'');
        tr.append(a,b,c);body.append(tr);
      }
      table.append(body);box.replaceChildren(table);
    }catch(e){box.textContent='候補表を読み込めませんでした: '+e.message;}
  }
  document.addEventListener('DOMContentLoaded',()=>{refresh();loadAliases();window.addEventListener('puretomo:owned-changed',refresh);window.addEventListener('storage',event=>{if(event.key==='closetOwnedItems')refresh();});});
})();
