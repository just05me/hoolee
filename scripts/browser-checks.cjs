const BASE=process.env.BASE_URL || 'http://127.0.0.1:4321';
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 const b=await chromium.launch({headless:true,channel:'chrome'});
 let count=0;const errors=[];
 const p=await b.newPage();p.on('pageerror',e=>errors.push(e.message));
 for(const width of [320,390,768,1440]){
  await p.setViewportSize({width,height:900});
  for(const lang of ['ru','uz','en'])for(const route of ['','services/','cases/','cases/ark-core/','cases/anton/','about/','contact/']){
   const r=await p.goto(`${BASE}/${lang}/${route}`,{waitUntil:'domcontentloaded'});
   assert.equal(r.status(),200);assert.equal(await p.locator('h1').count(),1);
   const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
   assert.ok(!overflow,`${width} ${lang}/${route} overflow`);count++;
  }
 }
 await p.setViewportSize({width:390,height:844});await p.goto(BASE+'/ru/');
 await p.locator('#burger').click();assert.equal(await p.locator('#burger').getAttribute('aria-expanded'),'true');
 await p.keyboard.press('Escape');assert.equal(await p.locator('#burger').getAttribute('aria-expanded'),'false');
 await p.locator('.theme-btn').click();assert.equal(await p.locator('html').getAttribute('data-theme'),'light');
 await p.reload();assert.equal(await p.locator('html').getAttribute('data-theme'),'light');
 await p.goto(BASE+'/ru/contact/');
 await p.locator('[data-send="telegram"]').click();assert.equal(await p.locator('[name="name"]').getAttribute('aria-invalid'),'true');
 await p.locator('[name="name"]').fill('QA');await p.locator('[name="contact"]').fill('test@example.com');await p.locator('[name="message"]').fill('Browser regression — intercepted, not delivered');
 await p.route('**/api/lead',r=>r.fulfill({status:503,contentType:'application/json',body:'{"ok":false}'}));
 await p.locator('[name="message"]').press('Control+Enter');
 await p.locator('[data-send="telegram"]').click();await p.locator('.status.err').waitFor();
 assert.equal(await p.locator('[name="name"]').inputValue(),'QA');
 await p.unroute('**/api/lead');await p.route('**/api/lead',r=>r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'}));
 await p.locator('[data-send="telegram"]').click();await p.locator('.status.ok').waitFor();assert.equal(await p.locator('[name="name"]').inputValue(),'');
 await p.goto(BASE+'/ru/');await p.screenshot({path:'/tmp/hoolee-light-mobile.png'});
 const nojs=await b.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});const q=await nojs.newPage();await q.goto(BASE+'/ru/');assert.ok(await q.locator('h1').isVisible());assert.ok(await q.locator('.nav').isVisible());assert.ok(!await q.locator('[data-send="telegram"]').isVisible());
 await p.locator('.theme-btn').click();await p.setViewportSize({width:1440,height:1000});await p.reload();await p.screenshot({path:'/tmp/hoolee-final-desktop.png'});
 assert.deepEqual(errors,[]);console.log(`PASS: ${count} page/viewport checks; mobile menu, theme persistence, form validation/failure/success, no-JS, no JS errors.`);await b.close();
})().catch(e=>{console.error(e);process.exit(1)})
