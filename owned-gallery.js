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
  document.addEventListener('DOMContentLoaded',()=>{refresh();window.addEventListener('puretomo:owned-changed',refresh);window.addEventListener('storage',event=>{if(event.key==='closetOwnedItems')refresh();});});
})();
