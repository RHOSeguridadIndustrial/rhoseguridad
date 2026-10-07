const {chromium}=require('playwright');const fs=require('node:fs');const http=require('node:http');const path=require('node:path');const assert=require('node:assert/strict');
const mock=`
const user={id:'11111111-1111-4111-8111-111111111111'};
const verified=()=>sessionStorage.getItem('testVerified')==='yes';
export const supabase={
 auth:{getUser:async()=>({data:{user}}),getSession:async()=>({data:{session:{user}}}),signOut:async()=>({}),onAuthStateChange:()=>{},mfa:{
 listFactors:async()=>({data:{totp:window.testFactors?[{id:'factor-demo',status:'verified',friendly_name:'Autenticador de ejemplo'}]:[],all:[]}}),
 getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:verified()?'aal2':'aal1'}}),
 enroll:async()=>({data:{id:'factor-demo',totp:{qr_code:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="white"/><text x="20" y="100">EJEMPLO SIN CLAVE REAL</text></svg>'),secret:'DEMO-SIN-CLAVE-REAL'}}}),
 unenroll:async()=>({}),challengeAndVerify:async({code})=>{if(code!=='123456')return {error:{message:'Invalid'}};sessionStorage.setItem('testVerified','yes');return {data:{}};}
 }},
 rpc:async()=>({data:!window.testExpired}),
 from:()=>({select(){return this},eq(){return this},single:async()=>({data:{role:window.testRole||'admin'}}),maybeSingle:async()=>({data:{role:window.testRole||'admin'}})})
};`;
(async()=>{
 const root=process.cwd();const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://localhost').pathname;res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');
 if(p==='/supabase-client.js'){res.end(mock);return;}
 if(p==='/admin.html'){res.end('<!doctype html><title>Panel protegido de prueba</title><p>Verificación completada</p>');return;}
 if(p==='/login.html'||p==='/index.html'){res.end('<!doctype html><title>Redirección segura</title>');return;}
 try{let s=fs.readFileSync(path.join(root,p));if(p==='/admin-seguridad.html')s=s.toString().replace('<body>','<body><div style="text-align:center;padding:10px;background:#fff3e9;color:#954116;font:700 11px Arial">VISTA PREVIA · SIN PUBLICAR</div>');res.end(s);}catch{res.writeHead(404);res.end();}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.RHO_CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:430,height:1000},deviceScaleFactor:2});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE',e.message)});page.on('console',m=>{if(m.type()==='error')console.error(m.text())});
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'||r.request().url().startsWith('data:')?r.continue():r.abort());
 await page.goto(origin+'/admin-seguridad.html?next=https://evil.example');await page.getByRole('button',{name:'Vincular mi autenticador',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 if(process.env.RHO_PREVIEW_OUTPUT)await page.screenshot({path:process.env.RHO_PREVIEW_OUTPUT,fullPage:true});
 await page.getByRole('button',{name:'Vincular mi autenticador',exact:true}).click();await page.getByLabel('Clave de configuración').waitFor();
 assert.equal(await page.getByLabel('Clave de configuración').inputValue(),'DEMO-SIN-CLAVE-REAL');
 await page.getByLabel('Código de tu autenticador',{exact:true}).fill('999999');await page.getByRole('button',{name:'Verificar y continuar'}).click();await page.getByText('El código no es válido o expiró. Captura el código actual de tu autenticador.',{exact:true}).waitFor();
 await page.getByLabel('Código de tu autenticador',{exact:true}).fill('123456');await page.getByRole('button',{name:'Verificar y continuar'}).click();await page.waitForURL(origin+'/admin.html');
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('rho_pending_mfa_factor')),null);
 await page.evaluate(()=>sessionStorage.removeItem('testVerified'));
 await page.addInitScript(()=>window.testFactors=true);
 await page.goto(origin+'/admin-seguridad.html?next=admin-precios.html');await page.getByLabel('Código de tu autenticador',{exact:true}).waitFor();assert.equal(await page.locator('#setup').isVisible(),false);
 await page.addInitScript(()=>window.testRole='customer');await page.goto(origin+'/admin-seguridad.html');await page.waitForURL(origin+'/index.html');
 assert.deepEqual(errors,[]);console.log('PASS enrollment, code error/success, secret cleanup, safe redirects, existing-factor challenge, non-admin rejection and mobile layout');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1)});
