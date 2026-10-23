const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');

let server,browser,origin;
before(async()=>{
 const html=fs.readFileSync(path.join(__dirname,'..','index.html'));
 server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
});
after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve))});

async function app(t,options={}){
 const context=await browser.newContext({viewport:{width:1440,height:1000},...options});
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 // Exercise offline editing without loading production Firebase or touching real accounts.
 await page.route('https://**/*',r=>r.abort());
 await page.goto(origin);
 await page.locator('#lk-off').click();
 await page.waitForFunction(()=>document.documentElement.classList.contains('unlocked'));
 await page.locator('#lock').waitFor({state:'hidden'});
 t.after(async()=>{await context.close();assert.deepEqual(errors,[],'No uncaught browser errors')});
 return page;
}

test('visible paste controls and right-click copy distinguish text from pages',async t=>{
 const p=await app(t);
 assert.equal(await p.locator('#paste-main-btn').innerText(),'Paste page');
 assert.equal(await p.locator('#paste-chapter-btn').innerText(),'Paste chapter');
 const card=p.locator('.card').first();
 const expected=await card.locator('.cc').innerText();
 await card.click({button:'right',position:{x:20,y:20}});
 await p.locator('#menu-context').getByRole('menuitem',{name:'Copy text',exact:true}).click();
 assert.equal(await p.evaluate(()=>navigator.clipboard.readText()),expected);
 assert.match(await p.locator('#toast').innerText(),/Copied/);
});

test('organizational copy survives copying chat text and pastes into a board',async t=>{
 const p=await app(t);
 const result=await p.evaluate(async()=>{
  const source=appData.pages.find(p=>p.chapterId===appData.activeChapterId);
  await copyPageData(source.id);await copyText('Response for the customer');
  const board={id:'test-board',chapterId:appData.activeChapterId,name:'Billing board',x:2,y:30,w:60,h:40};appData.containers.push(board);renderPages();
  return {id:source.id,title:source.title,content:source.content};
 });
 await p.locator('.cbar .cname').click({button:'right'});
 await p.locator('#menu-context').getByRole('menuitem',{name:'Paste page here',exact:true}).click();
 assert.deepEqual(await p.evaluate(()=>{const p=appData.pages.at(-1);return {title:p.title,content:p.content,containerId:p.containerId}}),{title:result.title,content:result.content,containerId:'test-board'});
 assert.equal(await p.evaluate(()=>navigator.clipboard.readText()),'Response for the customer');
});

test('right-click a chapter to paste directly without switching it first',async t=>{
 const p=await app(t);
 const target=await p.evaluate(async()=>{await copyPageData(appData.pages.find(p=>p.chapterId===appData.activeChapterId).id);return appData.chapters.find(c=>c.bookId===appData.activeBookId&&c.id!==appData.activeChapterId).id});
 await p.locator('.chip-ch[data-id="'+target+'"]').click({button:'right'});
 await p.locator('#menu-context').getByRole('menuitem',{name:'Paste page into this chapter'}).click();
 assert.equal(await p.evaluate(()=>appData.pages.at(-1).chapterId),target);
 assert.equal(await p.evaluate(()=>appData.activeChapterId),target);
});

test('chapter copy preserves boards and variants in another book',async t=>{
 const p=await app(t);
 const expected=await p.evaluate(async()=>{
  const c=curChap();appData.containers.push({id:'copy-board',chapterId:c.id,name:'Test board',x:2,y:25,w:60,h:40});
  appData.pages.push({id:'copy-variant',chapterId:c.id,containerId:'copy-board',title:'One',content:'First',variants:[{title:'One',content:'First'},{title:'Two',content:'Second'}],activeVariant:1});
  await copyChapterData(c.id);const book=appData.books.find(b=>b.id!==c.bookId);return {book:book.id,name:c.name,pages:appData.pages.filter(p=>p.chapterId===c.id).length,boards:appData.containers.filter(b=>b.chapterId===c.id).length};
 });
 await p.locator('.tab[data-id="'+expected.book+'"]').click({button:'right'});
 await p.locator('#menu-context').getByRole('menuitem',{name:'Paste chapter into this book'}).click();
 assert.deepEqual(await p.evaluate(()=>({book:appData.activeBookId,name:curChap().name,pages:appData.pages.filter(p=>p.chapterId===appData.activeChapterId).length,boards:getCons().length})),expected);
 assert.deepEqual(await p.evaluate(()=>{const p=appData.pages.find(p=>p.chapterId===appData.activeChapterId&&p.variants?.some(v=>v.title==='Two'));return {content:p.content,active:p.activeVariant,board:!!appData.containers.find(b=>b.id===p.containerId&&b.chapterId===p.chapterId)}}),{content:'Second',active:1,board:true});
});

test('paste fallback pins its destination while clipboard permission is pending',async t=>{
 const p=await app(t);
 const expected=await p.evaluate(async()=>{
  const target=getPasteTarget(),source=appData.pages.find(p=>p.chapterId===target.chapterId);
  Object.defineProperty(navigator.clipboard,'readText',{configurable:true,value:()=>Promise.reject(new Error('Denied'))});
  await startPaste('page');selectBook(appData.books.find(b=>b.id!==target.bookId).id);
  return {target,clip:JSON.stringify({app:CLIP_TAG,type:'page',title:source.title,content:source.content})};
 });
 await p.locator('#paste-input').fill(expected.clip);
 await p.locator('#paste-modal').getByRole('button',{name:'Paste',exact:true}).click();
 assert.equal(await p.evaluate(()=>appData.pages.at(-1).chapterId),expected.target.chapterId);
 assert.equal(await p.evaluate(()=>appData.activeBookId),expected.target.bookId);
});

test('malformed copied data is rejected without changing templates',async t=>{
 const p=await app(t);
 assert.deepEqual(await p.evaluate(()=>{
  const count=appData.pages.length;
  const bad=[{type:'page',title:'bad',content:'x',variants:{}},{type:'chapter',name:'bad',pages:[null]},{type:'chapter',name:'bad',pages:[],containers:[null]},{type:'book'}];
  return {accepted:bad.map(o=>applyPaste(JSON.stringify({app:CLIP_TAG,...o}),'auto')),unchanged:count===appData.pages.length};
 }),{accepted:[false,false,false,false],unchanged:true});
});

test('variant values stay separate and title markup is treated as text',async t=>{
 const p=await app(t);
 assert.deepEqual(await p.evaluate(()=>{
  const page={id:'variant-test',chapterId:appData.activeChapterId,title:'A',content:'Name: XXX',variants:[{title:'<img src=x onerror="window.injected=true">',content:'Name: XXX'},{title:'B',content:'Policy: XXX'}],activeVariant:999};
  appData.pages.push(page);renderPages();varVals[page.id]={0:'Customer A'};
  switchPageVariant(page,1);const blank=composeSpiel(page).text;varVals[page.id][0]='Policy B';switchPageVariant(page,0);
  return {blank,restored:composeSpiel(page).text,title:nodes.get(page.id).querySelector('.ct').textContent.trim(),images:nodes.get(page.id).querySelectorAll('img').length,injected:!!window.injected};
 }),{blank:'Policy: XXX',restored:'Name: Customer A',title:'<img src=x onerror="window.injected=true">',images:0,injected:false});
});

test('copy failure is reported and cannot mark a chat as documented',async t=>{
 const p=await app(t);
 await p.evaluate(()=>{
  Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:()=>Promise.reject(new Error('Denied'))});document.execCommand=()=>false;
  openDocs();const e=docIndex()[0];chatOpenPage(chats[0],e);renderChats();
 });
 await p.locator('.cp .btn').first().click();
 assert.match(await p.locator('#toast').innerText(),/Copy failed/);
 assert.equal(await p.evaluate(()=>chats[0].noted),false);
 assert.equal(await p.evaluate(()=>copyText('text')),false);
});

test('fallback copy restores input focus and selection',async t=>{
 const p=await app(t);
 assert.deepEqual(await p.evaluate(async()=>{
  openModal('page-modal');const input=$('page-title-input');input.value='Example title';input.focus();input.setSelectionRange(2,7);
  Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:()=>Promise.reject(new Error('Denied'))});document.execCommand=()=>true;
  const ok=await copyText('response');return {ok,focused:document.activeElement===input,start:input.selectionStart,end:input.selectionEnd};
 }),{ok:true,focused:true,start:2,end:7});
});

test('page deletion can be undone with its filled fields',async t=>{
 const p=await app(t);
 const id=await p.evaluate(()=>{const p=appData.pages.find(p=>p.chapterId===appData.activeChapterId);varVals[p.id]={0:'Preserved'};return p.id});
 await p.locator('.card[data-pid="'+id+'"]').click({button:'right',position:{x:20,y:20}});
 await p.locator('#menu-context').getByRole('menuitem',{name:'Delete page',exact:true}).click();
 assert.equal(await p.evaluate(id=>appData.pages.some(p=>p.id===id),id),false);
 await p.locator('#undo').getByRole('button',{name:'Undo'}).click();
 assert.equal(await p.evaluate(id=>appData.pages.some(p=>p.id===id)&&varVals[id][0]==='Preserved',id),true);
});

test('keyboard menu navigation, Escape, and native input context menus',async t=>{
 const p=await app(t);
 await p.locator('.card').first().focus();await p.keyboard.press('Shift+F10');
 assert.equal(await p.evaluate(()=>document.activeElement.textContent),'Copy text');
 await p.keyboard.press('End');assert.equal(await p.evaluate(()=>document.activeElement.textContent),'Paste from system clipboard…');
 await p.keyboard.press('Escape');assert.equal(await p.locator('#menu-context.show').count(),0);
 assert.equal(await p.evaluate(()=>document.activeElement.classList.contains('card')),true);
 await p.evaluate(()=>openAddPageModal());
 assert.equal(await p.locator('#page-content-input').evaluate(n=>n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))),true);
});

test('Ctrl+V outside editors pastes into the focused board, not into a text input',async t=>{
 const p=await app(t);
 assert.deepEqual(await p.evaluate(async()=>{
  await copyPageData(appData.pages.find(p=>p.chapterId===appData.activeChapterId).id);
  const b={id:'keyboard-board',chapterId:appData.activeChapterId,name:'Keyboard board',w:60,h:40};appData.containers.push(b);renderPages();
  const dt=new DataTransfer();dt.setData('text/plain',appClipboard);nodes.get(b.id).dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}));
  const target=appData.pages.at(-1).containerId,count=appData.pages.length;openAddPageModal();$('page-content-input').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}));
  return {target,unchanged:count===appData.pages.length};
 }),{target:'keyboard-board',unchanged:true});
});

test('widget timers are disposed on navigation',async t=>{
 const p=await app(t);
 const result=await p.evaluate(()=>{
  openTools();const p=newWidgetPage('clock',TOOLS_ID);appData.pages.push(p);renderPages();const before=Object.keys(window.widgetIntervals).length;
  closeTools();return {before,after:Object.keys(window.widgetIntervals).length};
 });assert.ok(result.before>=1);assert.equal(result.after,0);
});

test('HTML export excludes session-only customer chat markup',async t=>{
 const p=await app(t);
 assert.equal(await p.evaluate(()=>{openDocs();chats[0].name='PRIVATE CUSTOMER SESSION';renderChats();return generateUpdatedHtmlString().includes('PRIVATE CUSTOMER SESSION')}),false);
});

test('storage failures show a warning and retain changes for retry',async t=>{
 const p=await app(t);
 assert.deepEqual(await p.evaluate(()=>{
  const old=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw new DOMException('Full','QuotaExceededError')};persistView();flushLocal();
  const failed={dirty:_pD,warning:$('toast').textContent.includes('storage is full or blocked')};Storage.prototype.setItem=old;flushLocal();return {...failed,recovered:!_pD};
 }),{dirty:true,warning:true,recovered:true});
});

test('backup adoption works in memory when browser storage is full',async t=>{
 const p=await app(t);
 assert.deepEqual(await p.evaluate(()=>{
  const replacement=structuredClone(appData);replacement.books[0].name='Restored backup';const old=Storage.prototype.setItem;
  Storage.prototype.setItem=()=>{throw new DOMException('Full','QuotaExceededError')};window.adoptData(replacement);Storage.prototype.setItem=old;
  return {name:appData.books[0].name,retry:_pD};
 }),{name:'Restored backup',retry:true});
});

test('invalid backups are rejected before replacing current data',async t=>{
 const p=await app(t);
 assert.deepEqual(await p.evaluate(()=>{
  const before=JSON.stringify(appData);let rejected=false;try{window.adoptData({books:[],chapters:[],pages:[null]})}catch(e){rejected=true}
  return {rejected,unchanged:before===JSON.stringify(appData)};
 }),{rejected:true,unchanged:true});
});

test('variant picker clicks restore the matching filled fields',async t=>{
 const p=await app(t);
 await p.evaluate(()=>{const p={id:'picker-test',chapterId:appData.activeChapterId,title:'Name',content:'Name: XXX',variants:[{title:'Name',content:'Name: XXX'},{title:'Policy',content:'Policy: XXX'}],activeVariant:0};appData.pages.push(p);renderPages()});
 const card=p.locator('.card[data-pid="picker-test"]');
 await card.locator('.var').fill('Customer');
 await card.getByRole('button',{name:'Switch variant'}).click();
 assert.equal(await card.locator('.var').innerText(),'XXX');
 await card.locator('.var').fill('Policy 123');
 await card.getByRole('button',{name:'Switch variant'}).click();
 assert.equal(await card.locator('.var').innerText(),'Customer');
 await card.getByRole('button',{name:'Copy page text'}).click();
 assert.equal(await p.evaluate(()=>navigator.clipboard.readText()),'Name: Customer');
});

test('book deletion triggers data persistence even for a nonactive book',async t=>{
 const p=await app(t);
 const id=await p.evaluate(()=>{window.persistCalls=0;window.onPersist=()=>window.persistCalls++;const b=appData.books.find(b=>b.id!==appData.activeBookId);openEditBookModal(b.id);deleteBook();return b.id});
 await p.locator('#confirm-yes').click();
 await p.waitForFunction(id=>!appData.books.some(b=>b.id===id),id);
 assert.equal(await p.evaluate(()=>window.persistCalls),1);
 assert.equal(await p.evaluate(()=>!!curChap()),true);
});

test('downloaded HTML escapes script-closing template text',async t=>{
 const p=await app(t);
 assert.deepEqual(await p.evaluate(()=>{
  const payload='</script><script>window.injected=true</script>';appData.pages[0].content=payload;
  const html=generateUpdatedHtmlString(),embedded=html.match(/\/\*DATA_START\*\/([\s\S]*?)\/\*DATA_END\*\//)[1];
  return {raw:embedded.includes('</script>'),restored:JSON.parse(embedded).pages[0].content===payload};
 }),{raw:false,restored:true});
});

test('context menu stays within a small viewport and respects reduced motion',async t=>{
 const p=await app(t,{viewport:{width:390,height:750},reducedMotion:'reduce'});
 const rect=await p.evaluate(()=>{showContextMenu(document.querySelector('.card'),388,748,true);const m=$('menu-context'),r=m.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,animation:getComputedStyle(m).animationName}});
 assert.ok(rect.left>=8&&rect.right<=383&&rect.top>=8&&rect.bottom<=743,JSON.stringify(rect));
 assert.equal(rect.animation,'none');
});
