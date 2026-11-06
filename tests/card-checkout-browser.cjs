const {chromium,webkit}=require('playwright');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
// Isolated browser fixture. Every external request is blocked; no real Stripe,
// Supabase, customer, payment or inventory is used by this test.
const mock=`
window.calls=[];window.owner='11111111-1111-4111-8111-111111111111';window.behavior='success';window.payMode='prepared';
const listeners=[];window.authChange=()=>{window.owner=null;listeners.forEach(fn=>fn('SIGNED_OUT',null));};
const session=()=>window.owner?{user:{id:window.owner},access_token:'synthetic'}:null;
export const supabase={auth:{getSession:async()=>({data:{session:session()}}),onAuthStateChange:fn=>{listeners.push(fn);}},functions:{invoke:async(name,{body})=>{
window.calls.push({name,body});
if(window.behavior==='slow')await new Promise(r=>window.finish=r);
if(window.behavior==='network')return {error:{message:'RAW PRIVATE ERROR'}};
if(window.behavior===503)return {error:{context:{status:503}}};
if(body.action==='postal_lookup')return {data:{postalCode:body.postalCode,status:'postal_options',catalogSha256:'a'.repeat(64),options:[{postalCode:body.postalCode,municipalityCode:'002',settlementCode:'0001',municipality:'Azcapotzalco',settlement:'Colonia sintética'}]}};
const data={environment:'live',paymentMethod:'card',currency:'mxn',lines:body.items.map(i=>({sku:i.sku,quantity:i.quantity,name:window.behavior==='xss'?'<img src=x onerror=window.xss=1>':'Casco del servidor',unitPriceCents:7800,lineTotalCents:7800*i.quantity})),subtotalCents:7800,shippingCents:9900,totalCents:window.behavior==='wrongtotal'?1:17700,mode:'standard',delivery:{status:'postal_match',assurance:'postal_catalog_only',catalogSha256:'a'.repeat(64),address:{...body.address,municipality:'Azcapotzalco',settlement:'Colonia sintética'}}};
if(body.action==='create')Object.assign(data,{requestId:'33333333-3333-4333-8333-333333333333',sessionId:'cs_live_fixture',url:window.behavior==='unsafe'?'https://evil.invalid/pay':'https://checkout.stripe.com/c/pay/cs_live_fixture',expiresAt:Math.floor(Date.now()/1000)+3600});
return {data};
}},rpc:async(name,args)=>{
window.calls.push({name,args});if(window.behavior==='slow')await new Promise(r=>window.finish=r);
if(window.payMode==='null')return {data:null};
if(window.payMode==='error')return {error:{message:'RAW PRIVATE ERROR'}};
return {data:{requestId:'33333333-3333-4333-8333-333333333333',orderId:window.payMode==='paid'?'44444444-4444-4444-8444-444444444444':null,state:window.payMode,paymentStatus:['paid','reconciliation_required'].includes(window.payMode)?'paid':'unconfirmed',totalCents:17700,currency:'mxn'}};
}};`;
const cart=`window.items=[{id:'fixture-helmet',qty:1,name:'Casco de prueba'}];export const getCart=()=>window.items;export const clearCart=()=>{throw Error('must never clear cart on return');};`;
(async()=>{
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost'),file=url.pathname;
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
  if(file==='/supabase-client.js')return res.end(mock);
  if(file==='/cart.js')return res.end(cart);
  if(file==='/footer.js')return res.end('');
  const local=path.resolve(process.cwd(),'.'+file);
  if(!local.startsWith(process.cwd()+path.sep)){res.writeHead(403);return res.end();}
  try{res.end(fs.readFileSync(local));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{for(const [name,engine,viewport] of [['desktop',chromium,{width:1280,height:900}],['mobile',webkit,{width:390,height:844}]]){
  const browser=await engine.launch({headless:true});
  try{
   const page=await browser.newPage({viewport}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
   await page.goto(base+'/checkout-tarjeta.html');await page.getByText('Completa tus datos para consultar el total.').waitFor();
   await page.locator('#card-name').fill('Cliente de prueba');await page.locator('#card-phone').fill('5555555555');await page.locator('#card-postal').fill('02000');
   await page.locator('#card-lookup').click();await page.getByText('Selecciona tu colonia.',{exact:true}).waitFor();
   await page.locator('#card-settlement').selectOption('002:0001');await page.locator('#card-street').fill('Calle de prueba');await page.locator('#card-exterior').fill('10');
   const review=page.locator('#card-review'),pay=page.locator('#card-pay'),accept=page.locator('#card-accept'),open=page.locator('#card-open');
   await review.click();await page.getByText('Revisa el desglose y confirma los datos para continuar.').waitFor();
   assert.equal(await page.evaluate(()=>calls.filter(c=>c.body?.action==='create').length),0);
   assert.equal(await page.locator('#card-total').innerText(),'$177.00');assert.equal(await pay.isEnabled(),false);
   await accept.check();await page.evaluate(()=>window.behavior='network');await pay.click();
   await page.getByText('Revisa tu conexión y reintenta',{exact:false}).waitFor();
   const firstKey=await page.evaluate(()=>calls.at(-1).body.retryKey);assert.ok(firstKey);
   assert.ok(!(await page.locator('#card-status').innerText()).includes('RAW PRIVATE'));
   await page.evaluate(()=>window.behavior='success');await pay.click();await open.waitFor();
   assert.equal(await page.evaluate(()=>calls.at(-1).body.retryKey),firstKey);
   assert.equal(await page.evaluate(()=>calls.at(-1).body.expectedTotalCents),17700);
   assert.equal(await page.evaluate(()=>calls.at(-1).body.contact.name),'Cliente de prueba');
   assert.equal(await open.getAttribute('href'),'https://checkout.stripe.com/c/pay/cs_live_fixture');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   // Reload recovers frozen data and reuses the identical retry key.
   await page.reload();await page.getByText('Recuperamos tu intento anterior.',{exact:false}).waitFor();
   await accept.check();await pay.click();await open.waitFor();assert.equal(await page.evaluate(()=>calls.at(-1).body.retryKey),firstKey);
   // A modified recipient invalidates acceptance and changes the request identity.
   await page.locator('#card-name').fill('Otro receptor');assert.equal(await page.locator('#card-summary').isVisible(),false);
   await review.click();await page.getByText('Revisa el desglose y confirma los datos para continuar.').waitFor();
   await accept.check();await page.evaluate(()=>window.behavior='unsafe');await pay.click();
   await page.getByText('Revisa tu conexión y reintenta',{exact:false}).waitFor();assert.equal(await open.isVisible(),false);
   const newKey=await page.evaluate(()=>calls.at(-1).body.retryKey);assert.notEqual(newKey,firstKey);
   await page.evaluate(()=>window.behavior='slow');await pay.click();await page.waitForFunction(()=>typeof window.finish==='function');
   await page.evaluate(()=>{window.authChange();window.finish();});await page.waitForFunction(()=>!document.getElementById('card-review').disabled);
   assert.equal(await open.isVisible(),false);assert.equal(await page.locator('#card-summary').isVisible(),false);
   // UI remains off if backend gates are closed.
   await page.goto(base+'/checkout-tarjeta.html');await page.getByText('Recuperamos tu intento anterior.',{exact:false}).waitFor();
   await page.evaluate(()=>window.behavior=503);await accept.check();await pay.click();await page.getByText('El pago con tarjeta aún no está disponible.',{exact:false}).waitFor();
   assert.equal(await open.isVisible(),false);
   // Server-returned labels render as text; a changed quote never exposes payment.
   await page.locator('#card-name').fill('Nueva cotización');await page.evaluate(()=>window.behavior='xss');await review.click();
   await page.getByText('Revisa el desglose y confirma los datos para continuar.').waitFor();
   assert.equal(await page.locator('#card-lines img').count(),0);assert.equal(await page.evaluate(()=>window.xss),undefined);
   await page.locator('#card-name').fill('Total inconsistente');await page.evaluate(()=>window.behavior='wrongtotal');await review.click();
   await page.getByText('No pudimos confirmar la operación.',{exact:false}).waitFor();assert.equal(await page.locator('#card-summary').isVisible(),false);
   // The success URL only invokes the owner-scoped read-only RPC.
   await page.goto(base+'/pago-exitoso.html?session_id=cs_live_fixture');await page.getByRole('heading',{name:'Pago pendiente de confirmación'}).waitFor();
   assert.deepEqual(await page.evaluate(()=>calls.map(c=>c.name)),['card_checkout_status']);
   await page.evaluate(()=>window.payMode='paid');await page.locator('#payment-refresh').click();await page.getByRole('heading',{name:'Pago confirmado',exact:true}).waitFor();
   assert.equal(await page.locator('#amount').innerText(),'$177.00');assert.equal(await page.locator('#order').innerText(),'44444444');
   await page.evaluate(()=>window.authChange());await page.getByRole('heading',{name:'Verifica tu cuenta'}).waitFor();assert.equal(await page.locator('#summary').isVisible(),false);
   await page.reload();await page.getByRole('heading',{name:'Pago pendiente de confirmación'}).waitFor();
   for(const [mode,title] of [['reconciliation_required','Pago recibido; pedido en revisión'],['expired','La reserva venció'],['null','No encontramos esta compra'],['error','No pudimos consultar el pago']]){
    await page.evaluate(m=>window.payMode=m,mode);await page.locator('#payment-refresh').click();await page.getByRole('heading',{name:title,exact:true}).waitFor();
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.evaluate(()=>{window.behavior='slow';window.payMode='paid';});await page.locator('#payment-refresh').click();await page.waitForFunction(()=>typeof window.finish==='function');
   await page.evaluate(()=>{window.authChange();window.finish();});await page.getByRole('heading',{name:'Verifica tu cuenta'}).waitFor();assert.equal(await page.locator('#summary').isVisible(),false);
   await page.goto(base+'/pago-exitoso.html?session_id=cs_test_fixture');await page.getByRole('heading',{name:'Referencia de compra no válida'}).waitFor();assert.equal(await page.evaluate(()=>calls.length),0);
   assert.deepEqual(errors,[]);console.log('PASS '+name+': quote, acceptance, retry, reload, recipient change, unsafe link, auth races, closed gates, XSS, totals, and read-only payment states');
  }finally{await browser.close();}
 }}finally{await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
