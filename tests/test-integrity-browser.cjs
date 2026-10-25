// Synthetic session/RPC fixtures only; no remote account or payment writes.
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const sample={environment:'test',scope:'own_requests',checkedAt:'2026-10-25T02:00:00Z',detailsLimited:false,
 totals:{requests:1,receipts:1,orders:0,paid:0,receiptAmountCents:12370,paidAmountCents:0,review:1,reviewAmountCents:12370,reviewNotes:1,unpaid:0,transfersWithoutReceipt:0,dispatched:0,inconsistent:0,legacyEvidence:0},
 requests:[{requestId:'fixture-review',method:'card',amountCents:12370,receiptAmountCents:12370,state:'reconciliation_required',orderId:null,receiptAt:'2026-10-24T20:00:00Z',reviewed:true,preparation:'none',issues:[],legacyEvidence:false}]};
const client=`export const supabase={auth:{getSession:async()=>({data:{session:fixture.owner?{user:{id:fixture.owner}}:null}}),onAuthStateChange(fn){fixture.authChanged=fn;}},async rpc(name,args){fixture.calls.push({name,args});if(fixture.slow)await new Promise(resolve=>fixture.finish=resolve);if(fixture.error)return {error:{code:fixture.error,message:'PRIVATE DIAGNOSTIC'}};return {data:structuredClone(fixture.report)}}};`;
(async()=>{
 const server=http.createServer(async(req,res)=>{
  const p=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');
  if(p==='/supabase-client.js')return res.end(client);
  if(p==='/admin-security-guard.js')return res.end('export async function requireSecureAdmin(){if(!fixture.owner)throw Error();}');
  try{const file=path.resolve(root,'.'+p);if(!file.startsWith(root+path.sep))throw Error();res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true});
  try{
   const context=await browser.newContext({viewport:engine===webkit?{width:390,height:844}:{width:1280,height:900},locale:'es-MX'});
   await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
   let page;const errors=[];
   async function open(overrides={}){if(page)await page.close();page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(data=>{window.fixture=data;},{owner:'fixture-admin',report:sample,calls:[],...overrides});await page.goto(base+'/admin-control-pruebas.html');}
   await open();await page.locator('#report').waitFor({state:'visible'});
   assert.match(await page.locator('#review-warning').innerText(),/1 pagos siguen en revisión; 1 tienen una nota/);
   assert.match(await page.locator('#records').innerText(),/Nota registrada; el pago sigue en revisión/);
   assert.match(await page.locator('#records').innerText(),/\$123.70/);
   assert.equal(await page.locator('textarea').count(),0);assert.equal(await page.locator('input').count(),0);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.getByRole('button',{name:'Actualizar control'}).click();await page.locator('#report').waitFor({state:'visible'});
   assert.equal(await page.locator('#records article').count(),1);
   assert.ok(await page.evaluate(()=>fixture.calls.every(c=>c.name==='qw10_test_integrity'&&c.args===undefined)));
   await page.evaluate(()=>{fixture.error='503';});await page.getByRole('button',{name:'Actualizar control'}).click();
   await page.getByText('No se pudo completar el control.',{exact:false}).waitFor();assert.equal(await page.locator('#report').isVisible(),false);assert.equal(await page.locator('#records article').count(),0);
   assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE DIAGNOSTIC'));
   await page.evaluate(()=>{fixture.error=null;fixture.report.totals.inconsistent=1;fixture.report.requests[0].issues=['paid_without_order'];});
   await page.getByRole('button',{name:'Actualizar control'}).click();await page.getByText('Hay un recibo pagado sin orden.').waitFor();
   assert.match(await page.locator('#outcome').innerText(),/1 solicitudes con diferencias/);
   await page.evaluate(()=>{fixture.owner=null;fixture.authChanged('SIGNED_OUT');});
   await page.locator('#app').waitFor({state:'hidden'});assert.equal(await page.locator('#records article').count(),0);
   console.log('PASS '+engine.name()+': reviewed exception stays pending, exact money, read-only refresh, incident and error clearing');
   await open({owner:null});await page.locator('#login-help').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>fixture.calls.length),0);
   await open({error:'42501'});await page.locator('#login-help').waitFor({state:'visible'});assert.equal(await page.locator('#report').isVisible(),false);
   for(const mutate of [d=>d.environment='live',d=>d.totals.receipts=0,d=>d.requests[0].requestId='<img src=x onerror=alert(1)>']){
    const report=structuredClone(sample);mutate(report);await open({report});await page.getByText('No se pudo completar el control.',{exact:false}).waitFor();assert.equal(await page.locator('#records').innerText(),'');
   }
   await open({slow:true});await page.waitForFunction(()=>typeof fixture.finish==='function');
   await page.evaluate(()=>{fixture.owner='other-owner';fixture.authChanged('SIGNED_OUT');fixture.finish();});
   await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);assert.equal(await page.locator('#app').isVisible(),false);assert.equal(await page.locator('#records article').count(),0);
   await open({slow:true});await page.waitForFunction(()=>typeof fixture.finish==='function');
   await page.evaluate(()=>{fixture.owner='other-owner';fixture.finish();});
   await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);assert.equal(await page.locator('#app').isVisible(),false);
   const empty=structuredClone(sample);Object.keys(empty.totals).forEach(k=>empty.totals[k]=0);empty.requests=[];
   await open({report:empty});await page.getByText('Todavía no hay solicitudes de prueba en tu cuenta.').waitFor();
   assert.equal(await page.locator('#review-warning').isVisible(),false);assert.deepEqual(errors,[]);
   console.log('PASS '+engine.name()+': access, malformed reports, late reply after sign-out/account change and empty state');
   await context.close();
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
