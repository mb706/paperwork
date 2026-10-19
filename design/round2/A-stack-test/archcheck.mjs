import { parseSync } from 'oxc-parser';
const src = `export function f(){ const r = Math.random(); const s = Math.sin(1); return Date.now() + r + s; }`;
const { program } = parseSync('x.ts', src);
const banned = new Set(['random','sin','cos','tan','atan2','exp','log','pow','asin','acos','atan','sinh','cosh','tanh','expm1','log1p','log2','log10','cbrt','hypot']);
const hits = [];
(function walk(n){ if (!n || typeof n !== 'object') return; if (n.type === 'MemberExpression' && n.object?.type === 'Identifier' && n.object.name === 'Math' && banned.has(n.property?.name)) hits.push('Math.'+n.property.name+'@'+n.start);
  if (n.type === 'MemberExpression' && n.object?.name === 'Date') hits.push('Date.'+n.property?.name+'@'+n.start);
  for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v); } })(program);
console.log('banned API hits:', hits);
