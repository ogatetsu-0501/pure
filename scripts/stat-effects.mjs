// Puretomo: 【効果名+効果量】を持つ全アイテムをマスター収集対象にする。
// 数値計算だけは確定済みの変換だけを行う。未確認の略称は原文を保存する。
export function hasStatTag(name) {
  return /^【[^+】]+\+[^】]+】/.test(String(name ?? ''));
}

export function statTag(name) {
  const match=String(name ?? '').match(/^【([^+】]+)\+([^】]+)】/);
  return match ? { alias:match[1].trim().replace(/[／⁄]/g,'/').toUpperCase(), raw:match[2].trim() } : null;
}

export const DEFAULT_ALIASES = {
  'AT/DF':['ATK','DEF'],
  'P/I':['POW','INT'],
  'P/L':['POW','LUK'],
  'S/L':['SPD','LUK'],
  'V/L':['VIT','LUK'],
  'ALL':['POW','INT','SPD','VIT','LUK'],
};

export function parseStatEffects(name,aliases=DEFAULT_ALIASES) {
  const tag=statTag(name);
  if(!tag) return [];
  const match=tag.raw.replace('％','%').match(/^(\d+(?:\.\d+)?)(?:%)?$/);
  if(!match) return [];
  const value=Number(match[1]);
  if(!Number.isFinite(value)||value<=0) return [];
  const types=Object.hasOwn(aliases,tag.alias)?aliases[tag.alias]:
    /^[A-Z][A-Z0-9]*$/.test(tag.alias)?[tag.alias]:[];
  if(!Array.isArray(types)) return [];
  return types.filter(t=>typeof t==='string'&&t).map(type=>({type,value}));
}
