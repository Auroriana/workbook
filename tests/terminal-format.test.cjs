const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
const contexts=[...html.matchAll(/ function formatHint\(o\)\{[\s\S]*?(?= function commit\(s,q\))/g)].map(m=>{const c={};vm.createContext(c);vm.runInContext(m[0],c);return c});
const field=(label,tok='XXX')=>({label,targets:[{tok}]});
test('date-named fields and date tokens normalize and validate across embedded copies',()=>{
 assert.equal(contexts.length,2);
 for(const c of contexts){
  for(const f of [field('Effective DATE'),field('Start','XX/XX/XXXX')]){
   assert.equal(c.formatHint(f),'XX-XX-XXXX');
   for(const v of ['2/9/2026','02-09-2026','02092026'])assert.equal(c.formatValue(f,v),'02-09-2026');
   assert.equal(c.formatValue(f,'02/29/2024'),'02-29-2024');
   for(const v of ['02/29/2025','04/31/2026','13/01/2026','XX-XX-XXXX','123'])assert.throws(()=>c.formatValue(f,v));
  }
 }
});
test('amounts and booleans get type-aware formatting while text stays intact',()=>{
 for(const c of contexts){assert.equal(c.formatValue(field('Premium','$XXX'),'-12.5'),'-$12.50');assert.equal(c.formatValue(field('Consent','[Yes]'),'YES'),'Yes');assert.throws(()=>c.formatValue(field('Consent','[Yes]'),'maybe'));assert.equal(c.formatValue(field('Name'),'Gabriel'),'Gabriel')}
});
