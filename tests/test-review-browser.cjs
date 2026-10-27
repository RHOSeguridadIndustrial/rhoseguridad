// Local page + synthetic auth/RPC adapters. Certifies UI behavior, not real MFA/iPhone.
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const record={request_id:'fixture-review-001',session_id:'cs_test_fixture_review',amount_cents:29100,reason:'reservation_expired',reviewed:false,recorded_at:'2026-10-23T20:00:00Z',items:[{sku:'fixture-cono',quantity:1}]};
const client=`export const supabase={auth:{async getSession(){return {data:{session:window.fixture.session?{user:{id:window.fixture.owner}}:null}}},onAuthStateChange(fn){window.fixture.authChanged=fn;queueMicrotask(()=>fn('INITIAL_SESSION',window.fixture.session?{user:{id:window.fixture.owner}}:null));}},async rpc(name,args){window.fixture.calls.push({name,args});if(window.fixture.fail)return {error:{code:'503',message:'fixture unavailable'}};if(args.p_action==='review'){const c=window.fixture.cases.find(c=>c.request_id===args.p_request);c.reviewed=true;c.note=args.p_note;c.reviewed_at='2026-10-23T20:01:00Z';if(window.fixture.loseResponse){window.fixture.loseResponse=false;return {error:{code:'503'}}}return {data:{environment:'test',status:'reviewed',requestId:c.request_id}}}const data={environment:window.fixture.environment,cases:JSON.parse(JSON.stringify(window.fixture.cases))};if(window.fixture.slow){window.fixture.slow=false;await new Promise(resolve=>window.fixture.finish=resolve);}return {data}}};`;
async function main(){
 const server=http.createServer(async(req,res)=>{
  try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/supabase-client.js'){res.setHeader('content-type','text/javascript');res.end(client);return;}
   if(url.pathname==='/admin-security-guard.js'){res.setHeader('content-type','text/javascript');res.end('export async function requireSecureAdmin(){if(!window.fixture.session)throw Error("session required");window.fixture.authChanged("SIGNED_IN",{user:{id:window.fixture.owner}});}');return;}
   const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep))throw Error();
   res.setHeader('content-type',file.endsWith('.html')?'text/html':'text/javascript');res.end(await fs.readFile(file));
  }catch{res.statusCode=404;res.end('Not found');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 let groups=0;
 try{for(const [type,width,height] of [[chromium,1280,900],[webkit,390,844]]){
  const browser=await type.launch({headless:true});
  try{const context=await browser.newContext({viewport:{width,height},isMobile:type===webkit,hasTouch:type===webkit,locale:'es-MX'});
   let page=await context.newPage();const errors=[];
   await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base)return route.abort();return route.continue();});
   async function open(overrides={}){await page.close();page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(data=>{window.fixture=data;},{session:true,owner:'fixture-owner',environment:'test',cases:[structuredClone(record)],calls:[],...overrides});await page.goto(base+'/admin-revision-pruebas.html');}
   await open();await page.locator('#app').waitFor({state:'visible'});assert.match(await page.locator('#summary').textContent(),/1 sin resolver/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.evaluate(()=>{fixture.authChanged('SIGNED_IN',{user:{id:fixture.owner}});fixture.authChanged('TOKEN_REFRESHED',{user:{id:fixture.owner}});});
   assert.equal(await page.locator('#app').isVisible(),true);assert.equal(await page.locator('#cases article').count(),1);

   const area=page.locator('textarea');assert.equal(await area.getAttribute('minlength'),'12');
   const note='Revisión sintética: <script>window.unwanted=true</script> sin surtido real.';
   await area.fill(note);await page.getByRole('button',{name:'Registrar revisión'}).click();
   await page.getByText('Revisión registrada',{exact:true}).waitFor();assert.equal(await page.locator('textarea').count(),0);
   assert.equal(await page.evaluate(()=>window.unwanted),undefined);assert.match(await page.locator('#summary').textContent(),/1 sin resolver/);
   const calls=await page.evaluate(()=>fixture.calls);assert.ok(calls.every(c=>c.name==='qw10_test_review'));assert.equal(calls.filter(c=>c.args.p_action==='review').length,1);
   assert.deepEqual(calls.find(c=>c.args.p_action==='review').args,{p_action:'review',p_request:record.request_id,p_note:note});
   await page.evaluate(()=>{fixture.owner='different-owner';fixture.authChanged('SIGNED_OUT');});await page.locator('#app').waitFor({state:'hidden'});assert.equal(await page.locator('#cases article').count(),0);
   console.log(`PASS ${++groups}: ${type.name()} review, safe text, responsive layout and account-change clearing`);
   await open({loseResponse:true});await page.locator('#app').waitFor({state:'visible'});await page.locator('textarea').fill('Prueba de respuesta perdida al guardar.');await page.getByRole('button',{name:'Registrar revisión'}).click();
   await page.getByText('No se completó la operación.',{exact:false}).waitFor();assert.equal(await page.locator('textarea').count(),0);assert.equal(await page.locator('#summary').textContent(),'');await page.getByRole('button',{name:'Actualizar casos'}).click();await page.getByText('Revisión registrada',{exact:true}).waitFor();assert.equal(await page.locator('textarea').count(),0);
   console.log(`PASS ${++groups}: ${type.name()} lost committed response recovers by read without duplicate mutation`);
   const refund={refund_id:'re_fixture',event_id:'evt_fixture',amount_cents:29100,currency:'mxn',status:'succeeded',event_created:1792800000,recorded_at:'2026-10-25T20:00:00Z'};
   await open({cases:[{...record,reviewed:true,note:'Nota previa de la prueba.',reviewed_at:'2026-10-24T20:00:00Z',resolution:{state:'refunded',limited:false,refunds:[refund]}}]});
   await page.getByText('Reembolso de prueba confirmado',{exact:true}).waitFor();assert.match(await page.locator('#summary').textContent(),/0 sin resolver/);
   assert.match(await page.locator('#cases').textContent(),/re_fixture/);assert.match(await page.locator('#cases').textContent(),/evt_fixture/);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.equal(await page.locator('textarea').count(),0);
   await page.evaluate(()=>{fixture.fail=true;});
   await page.getByRole('button',{name:'Actualizar casos'}).click();await page.getByText('No se completó la operación.',{exact:false}).waitFor();
   assert.equal(await page.locator('#cases article').count(),0);assert.equal(await page.locator('#summary').textContent(),'');
   assert.equal(await page.getByText('Reembolso de prueba confirmado',{exact:true}).count(),0);
   await page.evaluate(()=>{fixture.fail=false;fixture.slow=true;});
   await page.getByRole('button',{name:'Actualizar casos'}).click();await page.waitForFunction(()=>typeof fixture.finish==='function');
   assert.equal(await page.locator('#cases article').count(),0);assert.equal(await page.locator('#summary').textContent(),'');
   await page.evaluate(()=>fixture.finish());await page.getByText('Reembolso de prueba confirmado',{exact:true}).waitFor();
   await page.evaluate(()=>{fixture.environment='live';});
   await page.getByRole('button',{name:'Actualizar casos'}).click();await page.getByText('No se completó la operación.',{exact:false}).waitFor();
   assert.equal(await page.locator('#cases article').count(),0);assert.equal(await page.locator('#summary').textContent(),'');
   await page.evaluate(()=>{fixture.environment='test';});
   await page.getByRole('button',{name:'Actualizar casos'}).click();await page.getByText('Reembolso de prueba confirmado',{exact:true}).waitFor();
   await page.evaluate(()=>{fixture.cases[0].resolution={state:'unresolved',limited:false,refunds:[{...fixture.cases[0].resolution.refunds[0],status:'failed'}]};});
   await page.getByRole('button',{name:'Actualizar casos'}).click();await page.getByText('Resolución pendiente',{exact:true}).waitFor();
   assert.match(await page.locator('#summary').textContent(),/1 sin resolver/);assert.equal(await page.getByText('Reembolso de prueba confirmado',{exact:true}).count(),0);
   await open({cases:[{...record,resolution:{state:'refunded',limited:false,refunds:[{...refund,amount_cents:1}]}}]});
   await page.locator('#login-help').waitFor({state:'visible'});assert.equal(await page.locator('#cases article').count(),0);
   console.log(`PASS ${++groups}: ${type.name()} signed refund resolution, later failure reopening, and malformed proof blocking`);
   await open({cases:[]});await page.getByText('No hay pagos de prueba pendientes de revisión.').waitFor();assert.equal(await page.locator('textarea').count(),0);
   await open({session:false});await page.locator('#login-help').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>fixture.calls.length),0);
   await open({environment:'live'});await page.locator('#login-help').waitFor({state:'visible'});assert.equal(await page.locator('#cases article').count(),0);
   for(const event of ['SIGNED_IN','TOKEN_REFRESHED']){
    await open();await page.locator('#app').waitFor({state:'visible'});
    await page.evaluate(event=>{fixture.owner='other-owner';fixture.authChanged(event,{user:{id:fixture.owner}});},event);
    assert.equal(await page.locator('#app').isVisible(),false);assert.equal(await page.locator('#cases article').count(),0);
   }
   await open({slow:true});await page.waitForFunction(()=>typeof fixture.finish==='function');
   await page.evaluate(()=>{fixture.owner='other-owner';fixture.authChanged('SIGNED_IN',{user:{id:fixture.owner}});fixture.finish();});
   await page.locator('#login-help').waitFor({state:'visible'});
   assert.equal(await page.locator('#app').isVisible(),false);assert.equal(await page.locator('#cases article').count(),0);
   console.log(`PASS ${++groups}: ${type.name()} same-owner continuity, changed-owner token refresh and late startup response clearing`);
   assert.deepEqual(errors,[]);console.log(`PASS ${++groups}: ${type.name()} empty, no-session and wrong-environment states never expose review controls`);
   await context.close();
  }finally{await browser.close();}
 }}finally{await new Promise(resolve=>server.close(resolve));}
 console.log(`RESULT: ${groups} review UI groups passed in desktop Chromium and mobile WebKit; synthetic identity only.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
