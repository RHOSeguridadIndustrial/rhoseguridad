const {chromium}=require('playwright');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const now='2026-10-08T16:00:00Z';
const mock=`
const user={id:'11111111-1111-4111-8111-111111111111'};
let stored=JSON.parse(sessionStorage.getItem('testCampaign')||'null')||{mode:'paused',revision:1,changed_at:'${now}',server_now:'${now}',contact_window_open:true,last_checked_at:null,events:[{created_at:'${now}',mode:'paused',revision:1,by_admin:false}]};
export const supabase={
 auth:{getUser:async()=>({data:{user:window.noUser?null:user}}),signOut:async()=>({}),onAuthStateChange:()=>{},mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:window.lowAssurance?'aal1':'aal2'}})}},
 from:()=>({select(){return this},eq(){return this},single:async()=>({data:{role:window.customer?'customer':'admin'}})}),
 rpc:async(name,args)=>{
  if(name==='admin_session_touch')return {data:true};
  if(window.offline)return {error:{code:'FETCH_ERROR'}};
  if(name==='admin_procurement_get')return {data:structuredClone(stored)};
  if(name==='admin_procurement_set'){
   window.saves=(window.saves||0)+1;
   if(window.conflict)return {error:{code:'40001'}};
   const old=stored.mode;stored={...stored,mode:args.p_mode,revision:stored.revision+1,changed_at:'${now}',events:[{created_at:'${now}',previous_mode:old,mode:args.p_mode,revision:stored.revision+1,by_admin:true},...stored.events]};
   sessionStorage.setItem('testCampaign',JSON.stringify(stored));return {data:structuredClone(stored)};
  }
  return {error:{code:'UNKNOWN'}};
 }
};`;
(async()=>{
 const root=process.cwd();const server=http.createServer((req,res)=>{
  const p=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');
  if(p==='/supabase-client.js'){res.end(mock);return;}
  if(['/login.html','/index.html','/admin-seguridad.html'].includes(p)){res.end('<!doctype html><title>Acceso protegido</title>');return;}
  try{res.end(fs.readFileSync(path.join(root,p)));}catch{res.writeHead(404);res.end();}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.RHO_CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto(origin+'/admin-compras.html');await page.getByText('Pausada',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Pausar',exact:false}).isDisabled(),true);
  await page.getByRole('button',{name:'Encender'}).click();await page.getByText('Activa',{exact:true}).waitFor();
  await page.reload();await page.getByText('Activa',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Pausar'}).click();await page.getByText('Pausada',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Apagar'}).click();await page.getByText('Apagada',{exact:true}).waitFor();
  assert.equal(await page.locator('#history tr').count(),4);
  await page.getByRole('button',{name:'Encender'}).click();await page.getByText('Activa',{exact:true}).waitFor();
  await page.evaluate(()=>window.conflict=true);await page.getByRole('button',{name:'Pausar'}).click();
  await page.getByText('Otro cambio se guardó primero. Actualice el estado antes de intentarlo de nuevo.').waitFor();
  for(const b of await page.locator('[data-mode]').all())assert.equal(await b.isDisabled(),true);
  await page.getByRole('button',{name:'Actualizar estado'}).click();await page.getByText('Activa',{exact:true}).waitFor();
  await page.evaluate(()=>{window.conflict=false;window.offline=true;});await page.getByRole('button',{name:'Pausar'}).click();
  await page.getByText('No se pudo confirmar el cambio. Actualice el estado antes de volver a intentar.').waitFor();
  await page.evaluate(()=>window.offline=false);await page.getByRole('button',{name:'Actualizar estado'}).click();
  await page.getByRole('button',{name:'Pausar'}).click();await page.getByText('Pausada',{exact:true}).waitFor();
  if(process.env.RHO_PREVIEW_DIR){fs.mkdirSync(process.env.RHO_PREVIEW_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.RHO_PREVIEW_DIR,'campaign-desktop.png'),fullPage:true});}
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.RHO_PREVIEW_DIR)await page.screenshot({path:path.join(process.env.RHO_PREVIEW_DIR,'campaign-mobile.png'),fullPage:true});
  await page.getByText('Ver reglas y significado de los controles').click();await page.getByText('Canales y presentación',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.addInitScript(()=>window.customer=true);await page.reload();await page.waitForURL(origin+'/index.html');
  const second=await browser.newPage();await second.addInitScript(()=>window.lowAssurance=true);await second.goto(origin+'/admin-compras.html');await second.waitForURL('**/admin-seguridad.html?next=admin-compras.html');
  const third=await browser.newPage();await third.addInitScript(()=>window.noUser=true);await third.goto(origin+'/admin-compras.html');await third.waitForURL(origin+'/login.html');
  assert.deepEqual(errors,[]);
  console.log('PASS controls, saved-state reload, stale write/network failures, audit, mobile, customer/anonymous rejection and MFA return route');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1)});
