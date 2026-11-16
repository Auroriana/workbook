const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8');
const c={};vm.createContext(c);vm.runInContext(html.match(/ function formatHint\(o\)\{[\s\S]*?(?= function commit\(s,q\))/)[0]+html.match(/ function detect\(items,line\)\{[\s\S]*?(?= function choose\(s,o\))/)[0],c);
const field=(label,command,tok='XXX')=>({label,command,targets:[{tok}]});
const items=[field('Name','name'),field('Effective Date','effective-date','XX/XX/XXXX'),field('Premium difference','premium-difference','$XXX')];
test('natural labels and typed values produce normalized previews',()=>{
 for(const [text,command,value] of [['name Gabriel','name','Gabriel'],['customer name: Gabriel Reyes','name','Gabriel Reyes'],['effective date November 20, 2026','effective-date','11-20-2026'],['11/20/2026','effective-date','11-20-2026'],['premium +$10 monthly','premium-difference','+$10 monthly']]){const r=c.detect(items,text);assert.equal(r.length,1,text);assert.equal(r[0].command,command);assert.equal(r[0].detected,value)}
});
test('invalid dates and ordinary notes are not applied; scope is respected',()=>{for(const text of ['call back tomorrow','Gabriel','02/30/2026','/name Gabriel'])assert.equal(c.detect(items,text).length,0);assert.equal(c.detect([],'name Gabriel').length,0)});
test('ambiguous types retain alternatives; explicit labels narrow them',()=>{const both=[...items,field('Expiration Date','expiration-date','XX/XX/XXXX')];assert.equal(c.detect(both,'11/20/2026').length,2);assert.equal(c.detect(both,'effective date 11/20/2026').length,1)});
vm.runInContext(html.match(/ function detectSentence\(items,text\)\{[\s\S]*?(?= function choose\(s,o\))/)[0],c);
const sentenceItems=[...items,field('Year / Make / Model','ymm')];
test('extracts the supplied typo-filled sentence into four fields',()=>{
 const r=c.detectSentence(sentenceItems,'cx name gabriel added a vehicl 2020 tesla model y eff nov 20 2026 increasd their premium by 20$ monthly');
 assert.deepEqual(Array.from(r,o=>[o.command,o.detected]),[['name','gabriel'],['ymm','2020 tesla model y'],['effective-date','11-20-2026'],['premium-difference','+$20.00 monthly']]);
});
test('sentence detection preserves scope, direction, and rejects conflicting mentions',()=>{
 assert.equal(c.detectSentence([],'cx name gabriel').length,0);
 assert.equal(c.detectSentence(sentenceItems,'decreased their premium by $20 monthly')[0].detected,'-$20.00 monthly');
 assert.equal(c.detectSentence(sentenceItems,'cx name gabriel cx name sam').length,0);
 assert.equal(c.detectSentence(sentenceItems,'eff feb 30 2026').length,0);
});
vm.runInContext(html.match(/ function detectEntry\(items,text\)\{[\s\S]*?(?= function choose\(s,o\))/)[0],c);
vm.runInContext(html.match(/ function intentTitles\(text\)\{[\s\S]*?(?= function syncDetected\(s\))/)[0],c);
c.ensureDocuments=()=>false;
vm.runInContext(html.match(/ function syncDetected\(s\)\{[\s\S]*?(?= function scheduleSync\(s\))/)[0]+html.match(/ function query\(value,caret\)\{[\s\S]*?(?= function match\(items,q\))/)[0],c);
test('live sync revises its values, removes stale values, and protects manual edits',()=>{
 const p={id:'p',vv:{0:{}},activeVariant:0};const o={...field('Name','name'),targets:[{pid:'p',vi:0,i:0,tok:'XXX',label:'Name'}]};
 Object.assign(c,{openFields:()=>[o],live:()=>p,varVals:{},chatSave(){},paint(){},feedback(){}});
 const s={chat:{name:'',pages:[p]},ta:{value:'cx name Gabriel'},root:{querySelector:()=>null}};
 c.syncDetected(s);assert.equal(p.vv[0][0],'Gabriel');
 s.ta.value='cx name Gabriel Reyes';c.syncDetected(s);assert.equal(p.vv[0][0],'Gabriel Reyes');assert.equal(s.chat.name,'Gabriel Reyes');
 s.ta.value='';c.syncDetected(s);assert.equal(p.vv[0][0],undefined);assert.equal(s.chat.name,'');
 s.ta.value='cx name Sam';c.syncDetected(s);p.vv[0][0]='Manual';p.scratch.locks={'0:0':true};s.ta.value='cx name Bob';c.syncDetected(s);assert.equal(p.vv[0][0],'Manual');
});
const terminationItems=[field('Customer Name','name'),field('Completed Action: Termination','completed-action-termination'),field('Reason for Termination','reason-for-termination'),field('Effective Date of New Coverage','effective-date-of-new-coverage','XX/XX/XXXX'),field('New Company Provided','new-company-provided','[Yes]'),field('If Yes, New Company','if-yes-new-company'),field('Effective Date of Termination','effective-date-of-termination','XX/XX/XXXX')];
test('termination sentence distinguishes dates and maps reason, insurer and action',()=>{
 const r=c.detectSentence(terminationItems,'name gabriel terminated auto reason sold card eff date november 12 2026 new insurance with progressive starting november 11 2026');
 const values=Object.fromEntries(Array.from(r,o=>[o.command,o.detected]));
 assert.deepEqual(values,{'name':'gabriel','completed-action-termination':'Auto policy terminated','reason-for-termination':'sold car','effective-date-of-termination':'11-12-2026','new-company-provided':'Yes','if-yes-new-company':'progressive','effective-date-of-new-coverage':'11-11-2026'});
});
test('replacement date requires replacement context; incomplete dates are not guessed',()=>{
 assert.equal(c.detectSentence(terminationItems,'starting november 11 2026').length,0);
 const r=c.detectSentence(terminationItems,'name gabriel eff date november 12 20');assert.equal(r.length,1);assert.equal(r[0].command,'name');
});
test('sync scheduling executes synchronously with no timer',()=>{
 const scheduleContext={enabled:true,chats:[],syncDetected(){scheduleContext.called=true}};const s={root:{isConnected:true},chat:{}};scheduleContext.chats.push(s.chat);vm.createContext(scheduleContext);
 vm.runInContext(html.match(/ function scheduleSync\(s\)\{[^\n]+/)[0],scheduleContext);scheduleContext.scheduleSync(s);assert.equal(scheduleContext.called,true);
});

test('comma entries infer name and combine vehicle year/model with full effective dates',()=>{
 const r=c.detectEntry(sentenceItems,'joshua, added vehicle, 2020, tesla model 5, effective nov 20 2026');
 assert.deepEqual(Array.from(r,o=>[o.command,o.detected]),[['name','joshua'],['ymm','2020 tesla model 5'],['effective-date','11-20-2026']]);
});
test('date punctuation stays intact; a year alone is never an effective date',()=>{
 const r=c.detectEntry(sentenceItems,'joshua, added vehicle, effective 2020, tesla model 5');
 assert.equal(r.some(o=>o.command==='effective-date'),false);
 assert.equal(c.detectEntry(sentenceItems,'name joshua, effective November 20, 2026').find(o=>o.command==='effective-date').detected,'11-20-2026');
});
test('bare leading name and misspelled termination fill requested auto action',()=>{
 const items=[...terminationItems,field('Requested Action: Termination request for','requested-action')];
 const r=c.detectSentence(items,'gabriel termianted auto policy reason sold car');
 const values=Object.fromEntries(Array.from(r,o=>[o.command,o.detected]));
 assert.equal(values.name,'gabriel');assert.equal(values['requested-action'],'auto');assert.equal(values['reason-for-termination'],'sold car');
});
test('old termination documents retain values and manual locks when requested action is added',()=>{
 vm.runInContext(html.match(/ function upgradeTermination\(p\)\{[\s\S]*?(?= function openFields\(chat\))/)[0],c);
 c.scanVars=text=>Array.from(text.matchAll(/XXX/g));c.varVals={};
 const p={id:'legacy',content:'Customer Name: XXX\nRequested Action: Termination request\nReason for Termination: XXX',vv:{0:{0:'Gabriel',1:'Sold car'}},scratch:{locks:{'0:1':true},auto:{'0:0':'Gabriel'}}};
 c.upgradeTermination(p);assert.equal(p.vv[0][0],'Gabriel');assert.equal(p.vv[0][2],'Sold car');assert.equal(p.vv[0][1],undefined);assert.equal(p.scratch.locks['0:2'],true);assert.match(p.content,/request for XXX/);
 c.upgradeTermination(p);assert.equal(p.vv[0][2],'Sold car');
});
test('routes termination, vehicle/driver endorsements and general outcomes',()=>{
 for(const [text,title] of [['gabriel terminated auto policy','termination'],['added vehicle','add'],['removed vehicle','remove'],['updated vehicle','update'],['suspended vehicle','suspend'],['restored vehicle','restore'],['added driver Jane','add driver'],['removed driver Jane','remove a driver'],['customer idle','general'],['transferred to billing','general']])assert.ok(c.intentTitles(text).includes(title),text);
 assert.equal(c.intentTitles('Gabriel called about something').length,0);
});
test('driver and vehicle sentences detect subject, date and customer separately',()=>{
 const driver=[field('Customer Name','name'),field('Name of Driver','driver'),field('Effective Date','effective-date','XX/XX/XXXX')];
 const r=c.detectAll(driver,'gabriel added driver Jane Smith effective nov 20 2026');
 assert.deepEqual(Array.from(r,o=>[o.command,o.detected]),[['name','gabriel'],['driver','Jane Smith'],['effective-date','11-20-2026']]);
 const vehicle=c.detectAll(sentenceItems,'gabriel removed vehicle 2020 tesla model y effective nov 20 2026');assert.equal(vehicle.find(o=>o.command==='ymm').detected,'2020 tesla model y');
});
test('general idle and transfer fill notes while keeping the customer name separate',()=>{
 const general=[field('Name','name'),field('Reason for Inquiry','reason'),field('Information/Advice Provided','information')];
 const r=c.detectAll(general,'gabriel transferred to billing');assert.equal(r.find(o=>o.command==='name').detected,'gabriel');assert.equal(r.find(o=>o.command==='information').detected,'transferred to billing');
 assert.equal(c.detectAll(general,'gabriel went idle').find(o=>o.command==='reason').detected,'Customer idle');
});
test('empty chat automatically opens one matching template and does not duplicate it',()=>{
 const cx={norm:s=>s.toLowerCase(),docIndex:()=>[{chap:'Notations',title:'Termination',vi:0,page:{id:'term',title:'Termination'}}],chatOpenPage(chat,e){chat.pages.push({src:e.page.id,activeVariant:e.vi})}};vm.createContext(cx);vm.runInContext(html.match(/ function intentTitles\(text\)\{[\s\S]*?(?= function detectAll\(items,text\))/)[0],cx);
 const s={ta:{value:'gabriel terminated auto policy'},chat:{pages:[]}};assert.equal(cx.ensureDocuments(s),true);assert.equal(s.chat.pages.length,1);assert.equal(cx.ensureDocuments(s),false);assert.equal(s.chat.pages.length,1);
});
