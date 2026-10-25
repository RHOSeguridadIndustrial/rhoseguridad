const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const row={requestId:'fixture-transfer',totalCents:12370,expiresAt:1892896885,expired:false,state:'awaiting_confirmation',orderId:null,receiptReference:null,recordedAt:null,preparation:'none',items:[{sku:'fixture-a',name:'N95 de prueba',quantity:1,unitPriceCents:2470,lineTotalCents:2470}]};
const client=`export const supabase={auth:{getSession:async()=>({data:{session:fixture.owner?{user:{id:fixture.owner}}:null}}),onAuthStateChange(fn){fixture.authChanged=fn;}},async rpc(name,args){fixture.calls.push({name,args});if(fixture.slow)await new Promise(resolve=>fixture.finish=resolve);if(fixture.error)return {error:{code:fixture.error,message:'PRIVATE'}};if(args.p_action==='list')return {data:{environment:fixture.environment||'test',limited:false,transfers:structuredClone(fixture.rows)}};let r=fixture.rows.find(x=>x.requestId===args.p_request);if(args.p_action==='confirm'){r.state=fixture.late?'reconciliation_required':'paid';r.orderId=fixture.late?null:7;r.preparation=fixture.late?'none':'pending';r.receiptReference=args.p_reference;r.recordedAt='2026-10-25T03:00:00Z';}if(args.p_action==='prepare')r.preparation='prepared';if(args.p_action==='dispatch')r.preparation='dispatched';return {data:{environment:'test',transfer:structuredClone(r)}};}};`;
(async()=>{
 const server=http.createServer(async(req,res)=>{const p=new URL(req.url,'http://localhost').pathname;res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');
 if(p==='/supabase-client.js')return res.end(client);if(p==='/admin-security-guard.js')return res.end('export async function requireSecureAdmin(){if(!fixture.owner)throw Error();fixture.authChanged("SIGNED_IN",{user:{id:fixture.owner}});}');
 try{const file=path.resolve(root,'.'+p);if(!file.startsWith(root+path.sep))throw Error();res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch({headless:true});try{
 const context=await browser.newContext({viewport:engine===webkit?{width:390,height:844}:{width:1280,height:900},locale:'es-MX'});await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());let page;const errors=[];
 async function open(overrides={}){if(page)await page.close();page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(data=>window.fixture=data,{owner:'fixture-admin',calls:[],rows:[row],...overrides});await page.goto(origin+'/admin-transfer-pruebas.html');}
 const amount=()=>page.getByLabel('Importe simulado · MXN'),reference=()=>page.getByLabel('Referencia ficticia'),ack=()=>page.getByLabel('Confirmo que esta es una simulación sin movimiento bancario.'),submit=()=>page.getByRole('button',{name:'Registrar confirmación simulada'});
 await open();await amount().waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.evaluate(()=>fixture.authChanged('SIGNED_IN',{user:{id:fixture.owner}}));assert.equal(await amount().isVisible(),true);
 await amount().fill('123.71');await ack().check();await submit().click();assert.equal(await page.evaluate(()=>fixture.calls.filter(c=>c.args.p_action==='confirm').length),0);
 await amount().fill('123.70');await reference().fill('BANKTEST-BROWSER1');await submit().click();await page.getByText('Orden de prueba #7 · Preparación pendiente',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Registrar salida · prueba'}).count(),0);
 await page.getByRole('button',{name:'Marcar preparado · prueba'}).click();await page.getByRole('button',{name:'Registrar salida · prueba'}).click();await page.getByText('Orden de prueba #7 · Salida registrada',{exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>fixture.calls.filter(c=>c.args.p_action!=='list').map(c=>c.args.p_action)),['confirm','prepare','dispatch']);
 console.log('PASS '+engine.name()+': exact amount, explicit simulation, one confirmation and ordered preparation/dispatch');
 await open({late:true,rows:[{...row,expired:true}]});await page.getByText('La reserva está vencida o inactiva.',{exact:false}).waitFor();await amount().fill('123.70');await ack().check();await submit().click();await page.getByText('Confirmación simulada en revisión',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Marcar preparado · prueba'}).count(),0);
 await open();await amount().waitFor();const oldReference=await reference().inputValue();await amount().fill('123.70');await ack().check();await page.evaluate(()=>fixture.error='503');await submit().click();await page.getByText('No se pudo confirmar el resultado.',{exact:false}).waitFor();assert.equal(await reference().inputValue(),oldReference);assert.equal(await amount().inputValue(),'123.70');
 await page.evaluate(()=>{fixture.error=null;fixture.slow=true;});await submit().click();await page.waitForFunction(()=>typeof fixture.finish==='function');
 await page.evaluate(()=>{fixture.owner='other-owner';fixture.authChanged('SIGNED_IN',{user:{id:fixture.owner}});fixture.finish();});await page.locator('#app').waitFor({state:'hidden'});assert.equal(await page.locator('#transfers').innerText(),'');
 await open({owner:null});await page.locator('#login-help').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>fixture.calls.length),0);
 await open({environment:'live'});await page.getByText('No se pudo confirmar el resultado.',{exact:false}).waitFor();assert.equal(await page.locator('#transfers').innerText(),'');
 await open({rows:[]});await page.getByText('Todavía no hay transferencias de prueba.',{exact:false}).waitFor();assert.deepEqual(errors,[]);
 console.log('PASS '+engine.name()+': late review, uncertain retry preserves reference, account change clears late response, access and malformed data');
 await context.close();}finally{await browser.close();}}}finally{await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
