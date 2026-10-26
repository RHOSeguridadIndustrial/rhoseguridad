const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const client=`export const supabase={auth:{getSession:async()=>({data:{session:fixture.owner?{access_token:'synthetic',user:{id:fixture.owner}}:null}}),onAuthStateChange(fn){fixture.authChanged=fn;queueMicrotask(()=>fn('INITIAL_SESSION',fixture.owner?{user:{id:fixture.owner}}:null));}},functions:{async invoke(name,{body}){fixture.calls.push({name,body});if(name==='test-order-preparation'){fixture.result.preparation.state=body.action==='prepare'?'prepared':'dispatched';return {data:{environment:'test'}};}const data=structuredClone(fixture.result);if(fixture.slow){fixture.slow=false;await new Promise(resolve=>fixture.finish=resolve);}return {data};}}};`;
(async()=>{
 const delivery=JSON.parse(await fs.readFile(path.join(root,'tests/fixtures/delivery-snapshot.json'),'utf8'));
 const result={environment:'test',state:'paid',orderId:'7',preparation:{state:'pending'},quote:{currency:'mxn',mode:'standard',subtotalCents:2470,shippingCents:9900,totalCents:12370,lines:[{sku:'fixture-n95',name:'N95 de prueba',quantity:1,unitPriceCents:2470,lineTotalCents:2470}],delivery}};
 const server=http.createServer(async(req,res)=>{const p=new URL(req.url,'http://localhost').pathname;res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');
  if(p==='/supabase-client.js')return res.end(client);
  try{const file=path.resolve(root,'.'+p);if(!file.startsWith(root+path.sep))throw Error();res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch({headless:true});try{
  const context=await browser.newContext({viewport:engine===webkit?{width:390,height:844}:{width:1280,height:900},locale:'es-MX'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());let page;const errors=[];
  async function open(overrides={}){if(page)await page.close();page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(data=>window.fixture=data,{owner:'fixture-admin',calls:[],result,...overrides});await page.goto(origin+'/confirmacion-prueba.html?session_id=cs_test_fixture');}
  await open();await page.getByText('Domicilio de prueba: Calle Ficticia 123',{exact:false}).waitFor();
  assert.match(await page.locator('#result-delivery').innerText(),/Portón ficticio azul/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal(await page.getByRole('button',{name:'Registrar salida · prueba'}).isEnabled(),false);
  await page.getByRole('button',{name:'Marcar preparado · prueba'}).click();await page.getByText('Pedido preparado · prueba',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Registrar salida · prueba'}).click();await page.getByText('Salida registrada · prueba',{exact:true}).waitFor();
  assert.match(await page.locator('#result-delivery').innerText(),/Calle Ficticia 123/);
  assert.deepEqual(await page.evaluate(()=>fixture.calls.filter(c=>c.name==='test-order-preparation').map(c=>c.body.action)),['prepare','dispatch']);
  console.log('PASS '+engine.name()+': card confirmation retains frozen address, reference and mobile layout through prepare/dispatch');
  await page.evaluate(()=>{fixture.owner=null;fixture.authChanged('SIGNED_OUT',null);});await page.getByText('Verifica tu sesión de administrador',{exact:true}).waitFor();
  assert.equal(await page.locator('#result-delivery').textContent(),'');assert.equal(await page.locator('#result-items').textContent(),'');
  const legacy={...result,quote:{...result.quote,delivery:null}};await open({result:legacy});await page.getByText('Prueba rápida sin domicilio postal registrado.',{exact:false}).waitFor();
  for(const bad of [{...result,quote:{...result.quote,delivery:{...delivery,assurance:'physical_verified'}}},{...result,state:'reconciliation_required'},{...result,state:'pending'}]){
   await open({result:bad});await page.waitForFunction(()=>!document.getElementById('result-refresh').disabled);
   assert.equal(await page.locator('#result-delivery').textContent(),'');assert.equal(await page.locator('#result-detail').isVisible(),false);
   assert.equal(await page.locator('#prepare-test').isEnabled(),false);
  }
  await open({slow:true});await page.waitForFunction(()=>typeof fixture.finish==='function');
  await page.evaluate(()=>{fixture.owner=null;fixture.authChanged('SIGNED_OUT',null);fixture.finish();});await page.getByText('Verifica tu sesión de administrador',{exact:true}).waitFor();
  assert.equal(await page.locator('#result-delivery').textContent(),'');
  // A -> B -> A must still invalidate the first A response.
  await open({slow:true});await page.waitForFunction(()=>typeof fixture.finish==='function');
  await page.evaluate(()=>{fixture.result.quote.delivery.address.street='Calle Reciente';fixture.owner='other';fixture.authChanged('SIGNED_IN',{user:{id:'other'}});fixture.owner='fixture-admin';fixture.authChanged('SIGNED_IN',{user:{id:fixture.owner}});});
  await page.getByText('Domicilio de prueba: Calle Reciente 123',{exact:false}).waitFor();await page.evaluate(()=>fixture.finish());
  assert.match(await page.locator('#result-delivery').innerText(),/Calle Reciente/);assert.deepEqual(errors,[]);
  console.log('PASS '+engine.name()+': legacy, malformed/review/pending, sign-out and late response after account round-trip');
  await context.close();
 }finally{await browser.close();}}}finally{await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
