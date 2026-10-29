const {chromium,webkit}=require('playwright');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
// Synthetic login/MFA only. No provider requests, credentials or purchases.
const mock=`
const user=()=>sessionStorage.signed==='yes'?{id:'fixture'}:null;
export const supabase={auth:{getUser:async()=>({data:{user:user()}}),
signInWithPassword:async()=>{sessionStorage.signed='yes';return {data:{user:user()}}},
signOut:async()=>{sessionStorage.removeItem('signed');return {}},
mfa:{listFactors:async()=>({data:{totp:[{id:'fixture',status:'verified'}]}}),
getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:sessionStorage.verified==='yes'?'aal2':'aal1'}}),
challengeAndVerify:async({code})=>{if(code!=='123456')return {error:{}};sessionStorage.verified='yes';return {}}}},
from:()=>({select(){return this},eq(){return this},single:async()=>({data:{role:sessionStorage.role||'admin'}}),maybeSingle:async()=>({data:{role:sessionStorage.role||'admin'}})}),
rpc:async()=>({data:true})};`;
(async()=>{
 const server=http.createServer((req,res)=>{
  const p=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');
  if(p==='/supabase-client.js')return res.end(mock);
  if(['/admin.html','/checkout-prueba.html','/cuenta.html','/index.html'].includes(p))return res.end('<!doctype html><p>Destination fixture</p>');
  if(p==='/footer.js')return res.end('');
  try{res.end(fs.readFileSync(path.join(process.cwd(),p)))}catch{res.writeHead(404);res.end()}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 try{for(const engine of [chromium,webkit]){
  const browser=await engine.launch({headless:true});
  try{
   const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
   await page.goto(origin+'/admin-seguridad.html?next=checkout-prueba.html');
   await page.waitForURL(origin+'/login.html?next=checkout-prueba.html');
   await page.locator('[name=email]').fill('fixture@example.com');
   await page.locator('[name=password]').fill('fixture-only');
   await page.getByRole('button',{name:'Ingresar',exact:true}).click();
   await page.waitForURL(origin+'/admin-seguridad.html?next=checkout-prueba.html');
   await page.locator('#code').fill('000000');await page.getByRole('button',{name:'Verificar y continuar'}).click();
   await page.getByText('El código no es válido o expiró.',{exact:false}).waitFor();
   assert.ok(page.url().includes('admin-seguridad.html'));
   await page.locator('#code').fill('123456');await page.getByRole('button',{name:'Verificar y continuar'}).click();
   await page.waitForURL(origin+'/checkout-prueba.html');
   await page.goto(origin+'/admin-seguridad.html?next=checkout-prueba.html');
   await page.getByRole('link',{name:'Volver a la compra de prueba'}).click();
   await page.waitForURL(origin+'/checkout-prueba.html');
   for(const target of ['https://evil.invalid','//evil.invalid','../checkout-prueba.html','checkout-prueba.html?next=https://evil.invalid']){
    await page.goto(origin+'/login.html?next='+encodeURIComponent(target));
    await page.waitForURL(origin+'/admin-seguridad.html?next=admin.html');
    await page.locator('#ready').waitFor();assert.equal(await page.locator('#continue').getAttribute('href'),'admin.html');
   }
   await page.evaluate(()=>sessionStorage.role='customer');
   await page.goto(origin+'/login.html?next=checkout-prueba.html');await page.waitForURL(origin+'/cuenta.html');
   await page.goto(origin+'/admin-seguridad.html?next=checkout-prueba.html');await page.waitForURL(origin+'/index.html');
   assert.deepEqual(errors,[]);
   console.log('PASS '+engine.name()+': login → MFA → checkout; invalid code; existing MFA; unsafe redirects; customer rejection');
  }finally{await browser.close()}
 }}finally{server.close()}
})().catch(e=>{console.error(e);process.exit(1)});
