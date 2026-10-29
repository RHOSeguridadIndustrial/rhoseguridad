const {chromium,webkit}=require('playwright');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
// Synthetic identities and provider replies; no remote account, stock or payment access.
const mock=`
window.calls=[];window.mode='success';window.owner='fixture-admin';
let listener=()=>{};window.authEvent=event=>listener(event);
export const supabase={auth:{getSession:async()=>({data:{session:window.owner?{user:{id:window.owner},access_token:'synthetic'}:null}}),onAuthStateChange(fn){listener=fn;}},functions:{invoke:async(name,{body})=>{
window.calls.push(body);if(window.mode==='slow')await new Promise(resolve=>window.finish=resolve);
if(window.mode==='network')return {error:{message:'DO NOT SHOW RAW ERROR'}};
if(['expired','unknown410'].includes(window.mode))return {error:{context:new Response(JSON.stringify({error:window.mode==='expired'?'test_transfer_expired':'other_error'}),{status:410})}};
if(Number.isInteger(window.mode))return {error:{context:{status:window.mode}}};
if(body.action==='postal_lookup')return {data:{environment:'test',postalCode:body.postalCode,status:body.postalCode==='99999'?'outside_coverage':'postal_options',catalogSha256:'a'.repeat(64),options:body.postalCode==='99999'?[]:[{postalCode:body.postalCode,municipalityCode:'002',settlementCode:'0353',municipality:'Alcaldía de prueba',settlement:'Colonia de prueba'}]}};
const price=window.mode==='coupon'?29900:6419,shipping=price<29900?9900:0;
const summary={...(body.deliveryMode?{delivery:{status:'postal_match',assurance:'postal_catalog_only',catalogSha256:'a'.repeat(64),address:{...body.address,municipality:'Alcaldía de prueba',settlement:'Colonia de prueba'}}}:{}),currency:'mxn',lines:[{sku:'fixture-helmet',name:window.mode==='text'?'<img src=x onerror=window.xss=1>':'Casco del servidor',quantity:1,unitPriceCents:price,lineTotalCents:price}],
subtotalCents:price,shippingCents:shipping,totalCents:window.mode==='badSummary'?1:price+shipping,mode:'standard',coupon:{applied:shipping===0,registered:true},expiresAt:1792900000};
if(body.paymentMethod==='transfer')return {data:{environment:'test',paymentMethod:'transfer',status:'awaiting_test_transfer',reference:'TEST-fixture',...summary}};
return {data:{environment:'test',paymentMethod:'card',sessionId:'cs_test_fixture',url:window.mode==='unsafe'?'https://evil.invalid/c/pay/cs_test_fixture':'https://checkout.stripe.com/c/pay/cs_test_fixture',...summary}};
}}};`;
const cart=`window.items=[{id:'fixture-helmet',name:'Casco de prueba',qty:1}];export const getCart=()=>window.items;`;
(async()=>{
 const server=http.createServer((req,res)=>{
  const p=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');
  if(p==='/supabase-client.js')return res.end(mock);
  if(p==='/cart.js')return res.end(cart);
  try{res.end(fs.readFileSync(path.join(process.cwd(),p)))}catch{res.writeHead(404);res.end()}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true});
  try{
   const page=await browser.newPage({viewport:engine===webkit?{width:390,height:844}:{width:1280,height:900}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:'+server.address().port+'/checkout-prueba.html');
   const submit=page.locator('#test-prepare'),status=page.locator('#test-status'),help=page.locator('#test-help'),link=page.locator('#test-open');
   const summary=page.locator('#test-summary');
   async function run(mode,expected){await page.evaluate(m=>window.mode=m,mode);await submit.click();await page.getByText(expected,{exact:false}).waitFor();assert.equal(await submit.isEnabled(),true);}
   await page.evaluate(()=>window.owner=null);
   await run('success','Inicia sesión con tu cuenta');
   assert.equal(await page.evaluate(()=>calls.length),0);
   assert.equal(await help.getAttribute('href'),'admin-seguridad.html?next=checkout-prueba.html');
   await page.evaluate(()=>{window.owner='fixture-admin';window.items=[];window.dispatchEvent(new Event('rho-cart-changed'));});
   await run('success','El carrito está vacío');assert.equal(await help.getAttribute('href'),'carrito.html');
   await page.evaluate(()=>{window.items=[{id:'fixture-helmet',name:'Casco de prueba',qty:1}];window.dispatchEvent(new Event('rho-cart-changed'));});
   await page.getByLabel('Forma de pago').selectOption('transfer');
   assert.equal(await page.locator('#test-card-help').isVisible(),false);
   await run(401,'Inicia sesión con tu cuenta');
   await run(409,'Revisa que los artículos estén habilitados');
   assert.equal(await help.getAttribute('href'),'carrito.html');
   await run(503,'El servicio de pruebas no está disponible');assert.equal(await help.isVisible(),false);
   await run('network','Comprueba tu conexión');
   assert.ok(!(await status.innerText()).includes('DO NOT SHOW'));
   const beforeKey=await page.evaluate(()=>calls.at(-1).retryKey);
   await run('success','Transferencia simulada preparada: $163.19');
   assert.equal(await summary.isVisible(),true);
   assert.match(await summary.innerText(),/Casco del servidor/);assert.match(await summary.innerText(),/\$64.19/);
   assert.match(await summary.innerText(),/\$99.00/);assert.match(await summary.innerText(),/No aplicado/);
   assert.match(await summary.innerText(),/hora de Ciudad de México/);
   assert.equal(await page.evaluate(()=>calls.at(-1).retryKey),beforeKey);
   await submit.click();await page.getByText('Transferencia simulada preparada:',{exact:false}).waitFor();
   assert.equal(await page.evaluate(()=>calls.at(-1).retryKey),beforeKey);
   assert.equal(await help.isVisible(),true);assert.equal(await help.getAttribute('href'),'admin-transfer-pruebas.html?request=fixture');assert.equal(await link.isVisible(),false);
   // An uncertain request retains the retry key across reloads.
   await page.reload();await page.getByLabel('Forma de pago').selectOption('transfer');
   await run('success','Transferencia simulada preparada:');
   assert.equal(await page.evaluate(()=>calls.at(-1).retryKey),beforeKey);
   const restart=page.locator('#test-restart');
   await run('unknown410','Comprueba tu conexión');assert.equal(await restart.isVisible(),false);
   assert.equal(await summary.isVisible(),false);
   await run('expired','La reserva de esta transferencia simulada venció');
   assert.equal(await restart.isVisible(),true);assert.equal(await page.evaluate(()=>calls.at(-1).retryKey),beforeKey);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await submit.click();await page.getByText('La reserva de esta transferencia simulada venció',{exact:false}).waitFor();
   assert.equal(await page.evaluate(()=>calls.at(-1).retryKey),beforeKey);
   const callCount=await page.evaluate(()=>calls.length);
   await restart.click();await page.getByText('Ya puedes preparar una nueva transferencia simulada.',{exact:false}).waitFor();
   assert.equal(await page.evaluate(()=>calls.length),callCount);assert.equal(await restart.isVisible(),false);
   await run('success','Transferencia simulada preparada:');
   const freshKey=await page.evaluate(()=>calls.at(-1).retryKey);assert.notEqual(freshKey,beforeKey);
   await run('network','Comprueba tu conexión');assert.equal(await restart.isVisible(),false);
   await run('success','Transferencia simulada preparada:');assert.equal(await page.evaluate(()=>calls.at(-1).retryKey),freshKey);
   // Do not erase a newer retry key created in this tab while recovery was displayed.
   await run('expired','La reserva de esta transferencia simulada venció');
   await page.evaluate(()=>{const k='rho-test-checkout:fixture-admin',v=JSON.parse(sessionStorage.getItem(k));v.key='newer-key';sessionStorage.setItem(k,JSON.stringify(v));});
   await restart.click();await page.getByText('Comprueba tu conexión',{exact:false}).waitFor();
   assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('rho-test-checkout:fixture-admin')).key),'newer-key');
   await run('expired','La reserva de esta transferencia simulada venció');
   await page.getByLabel('Forma de pago').selectOption('card');
   assert.equal(await restart.isVisible(),false);
   assert.equal(await page.locator('#test-card-help').isVisible(),true);
   await run('expired','Comprueba tu conexión');assert.equal(await restart.isVisible(),false);
   await run('unsafe','No se pudo confirmar la preparación');assert.equal(await link.isVisible(),false);
   assert.equal(await summary.isVisible(),false);
   await run('badSummary','No se pudo confirmar la preparación');assert.equal(await link.isVisible(),false);assert.equal(await summary.isVisible(),false);
   await run('coupon','Importe simulado, con envío: $299.00');
   assert.match(await summary.innerText(),/Envío gratis aplicado/);assert.match(await summary.innerText(),/\$0.00/);
   await run('text','Importe simulado, con envío:');
   assert.match(await summary.innerText(),/<img src=x/);assert.equal(await summary.locator('img').count(),0);
   assert.equal(await page.evaluate(()=>window.xss),undefined);
   await run('success','Importe simulado, con envío:');assert.equal(await link.getAttribute('href'),'https://checkout.stripe.com/c/pay/cs_test_fixture');
   await page.evaluate(()=>{window.owner=null;window.authEvent('SIGNED_OUT');});
   assert.equal(await link.isVisible(),false);assert.equal(await link.getAttribute('href'),null);
   assert.equal(await summary.isVisible(),false);assert.equal(await summary.innerText(),'');
   assert.match(await status.innerText(),/Inicia sesión/);
   // A response that arrives after sign-out must not restore a private link or success message.
   await page.evaluate(()=>{window.owner='fixture-admin';window.mode='slow';});await submit.click();
   await page.waitForFunction(()=>typeof window.finish==='function');
   await page.evaluate(()=>{window.owner=null;window.authEvent('SIGNED_OUT');window.finish();});
   await page.waitForFunction(()=>!document.querySelector('#test-prepare').disabled);
   assert.equal(await link.isVisible(),false);assert.match(await status.innerText(),/Inicia sesión/);
   await page.evaluate(()=>{window.owner='fixture-admin';window.mode='slow';delete window.finish;});await submit.click();
   await page.waitForFunction(()=>typeof window.finish==='function');
   await page.getByLabel('Forma de pago').selectOption('transfer');await page.evaluate(()=>window.finish());
   await page.waitForFunction(()=>!document.querySelector('#test-prepare').disabled);
   assert.equal(await status.innerText(),'');assert.equal(await link.isVisible(),false);
   assert.equal(await summary.isVisible(),false);
   // A changed cart clears prior totals, including a response arriving later.
   await run('success','Transferencia simulada preparada:');
   await page.evaluate(()=>{window.mode='slow';delete window.finish;});await submit.click();
   await page.waitForFunction(()=>typeof window.finish==='function');
   await page.evaluate(()=>{window.items[0].qty=2;window.dispatchEvent(new Event('rho-cart-changed'));window.finish();});
   await page.waitForFunction(()=>!document.querySelector('#test-prepare').disabled);
   assert.equal(await summary.isVisible(),false);assert.equal(await status.innerText(),'');
   await page.evaluate(()=>{window.items[0].qty=1;window.dispatchEvent(new Event('rho-cart-changed'));});
   await run('success','Transferencia simulada preparada:');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.ok(await page.locator('#test-method').evaluate(e=>e.getBoundingClientRect().height>=44));
   assert.ok(await page.locator('#test-method').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=16));
   // Actual catalog-mode UI, synthetic server: no customer data or real reservations.
   await page.getByLabel('Validación de domicilio').selectOption('catalog');
   await page.getByLabel('Código postal',{exact:true}).fill('99999');
   await page.getByRole('button',{name:'Consultar código postal',exact:true}).click();
   await page.getByText('Este código postal no está incluido',{exact:false}).waitFor();
   assert.equal(await page.locator('#test-settlement').isEnabled(),false);
   await page.getByLabel('Código postal',{exact:true}).fill('02000');
   await page.getByRole('button',{name:'Consultar código postal',exact:true}).click();
   await page.getByText('Selecciona la colonia.',{exact:false}).waitFor();
   await page.getByLabel('Alcaldía y colonia').selectOption('002:0353');
   await page.getByLabel('Calle de prueba',{exact:true}).fill('Calle Ficticia');
   await page.getByLabel('Número exterior de prueba',{exact:true}).fill('123');
   await run('success','Transferencia simulada preparada:');
   assert.match(await summary.innerText(),/Calle Ficticia 123/);
   assert.match(await summary.innerText(),/Coincidencia postal; sin entrega real/);
   const postalKey=await page.evaluate(()=>calls.at(-1).retryKey);
   assert.equal(await page.evaluate(()=>calls.at(-1).deliveryMode),'catalog');
   assert.equal(await page.evaluate(()=>JSON.stringify(sessionStorage).includes('Calle Ficticia')),false);
   await run('success','Transferencia simulada preparada:');
   assert.equal(await page.evaluate(()=>calls.at(-1).retryKey),postalKey);
   await page.getByLabel('Número exterior de prueba',{exact:true}).fill('456');
   assert.equal(await summary.isVisible(),false);
   await run('success','Transferencia simulada preparada:');
   assert.notEqual(await page.evaluate(()=>calls.at(-1).retryKey),postalKey);
   await page.evaluate(()=>{window.mode='slow';delete window.finish;});await submit.click();
   await page.waitForFunction(()=>typeof window.finish==='function');
   await page.getByLabel('Calle de prueba',{exact:true}).fill('Otra Calle Ficticia');
   await page.evaluate(()=>window.finish());await page.waitForFunction(()=>!document.querySelector('#test-prepare').disabled);
   assert.equal(await summary.isVisible(),false);
   await page.getByLabel('Código postal',{exact:true}).fill('02001');
   assert.equal(await page.locator('#test-settlement').isEnabled(),false);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.evaluate(()=>{window.owner=null;window.authEvent('SIGNED_OUT');});
   assert.equal(await page.locator('#test-street').inputValue(),'');
   assert.deepEqual(errors,[]);
   console.log('PASS checkout help, retries, auth changes, late replies, safe links and layout: '+engine.name());
  }finally{await browser.close()}
 }}finally{server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
