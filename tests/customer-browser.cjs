const { chromium } = require('playwright');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const mock = `
const adminId='11111111-1111-4111-8111-111111111111';
const rows=[
{id:adminId,role:'admin',full_name:'Administrador RHO',company_name:'RHO',email:'admin@example.test'},
{id:'22222222-2222-4222-8222-222222222222',role:'customer',full_name:'Cliente de ejemplo 01',company_name:'Constructora Demo',email:'cliente01@example.test'},
{id:'33333333-3333-4333-8333-333333333333',role:'customer',full_name:'Cliente de ejemplo 02',company_name:'Servicios Demo',email:'cliente02@example.test'},
{id:'44444444-4444-4444-8444-444444444444',role:'customer',full_name:'Cliente de ejemplo 03',company_name:'',email:'cliente03@example.test',deactivated_at:'2026-10-01T00:00:00Z'}
].map((r,i)=>({created_at:'2026-10-07T12:00:00Z',updated_at:'2026-10-07T12:00:00+00:00',phone:'5555555555',deactivated_at:null,...r}));
window.previewCalls=[];
class Query {
 constructor(table){this.table=table;this.filters=[];this.start=0;this.end=49;}
 select(){return this;} order(){return this;} gte(){return this;} limit(){return this;}
 eq(k,v){this.filters.push(r=>r[k]===v);return this;}
 in(k,v){this.filters.push(r=>v.includes(r[k]));return this;}
 is(k,v){this.filters.push(r=>r[k]===v);return this;}
 not(k,op,v){this.filters.push(r=>r[k]!==v);return this;}
 or(expression){const term=expression.match(/%([^%]*)%/)[1].toLowerCase();this.filters.push(r=>[r.full_name,r.company_name,r.email].some(v=>(v||'').toLowerCase().includes(term)));return this;}
 range(start,end){this.start=start;this.end=end;return this;}
 single(){return Promise.resolve({data:this.result()[0],error:null});}
 result(){return (this.table==='profiles'?rows:[]).filter(r=>this.filters.every(f=>f(r)));}
 then(resolve,reject){const data=this.result();return Promise.resolve({data:data.slice(this.start,this.end+1),count:this.table==='site_visits'?79:data.length,error:null}).then(resolve,reject);}
}
export const supabase={
 auth:{getSession:async()=>({data:{session:{user:{id:adminId}}}}),signOut:async()=>({})},
 from:table=>new Query(table),
 functions:{invoke:async(name,{body})=>{window.previewCalls.push({name,body});if(window.previewFailure)return {error:{context:{json:async()=>({error:'Ese correo ya pertenece a otra cuenta de RHO.'})}}};const row=rows.find(r=>r.id===body.customer_id);if(body.action==='edit')for(const k of ['email','full_name','phone','company_name'])row[k]=body[k];else row.deactivated_at=body.action==='deactivate'?'2026-10-07T20:00:00Z':null;row.updated_at=new Date().toISOString();return {data:{ok:true}};}}
};`;
(async()=>{
 const root=process.cwd();
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/supabase-client.js'){res.setHeader('Content-Type','text/javascript');res.end(mock);return;}
  const file=path.join(root,pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try{let data=fs.readFileSync(file);if(pathname==='/admin.html')data=data.toString().replace('<body>','<body><div style="background:#fff3e9;color:#954116;text-align:center;padding:10px 12px;font:700 11px Arial;letter-spacing:.5px">VISTA PREVIA · DATOS DE EJEMPLO · SIN PUBLICAR</div>');res.setHeader('Content-Type',pathname.endsWith('.css')?'text/css':pathname.endsWith('.js')?'text/javascript':'text/html');res.end(data);}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const launch={headless:true};
 if(process.env.RHO_CHROMIUM_EXECUTABLE_PATH){launch.executablePath=process.env.RHO_CHROMIUM_EXECUTABLE_PATH;launch.args=['--no-sandbox'];}
 const browser=await chromium.launch(launch);
 try{
 const page=await browser.newPage({viewport:{width:430,height:1050},deviceScaleFactor:2});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto('http://127.0.0.1:'+server.address().port+'/admin.html');
 await page.getByRole('tab',{name:'Clientes',exact:true}).click();
 await page.getByText('Cliente de ejemplo 01',{exact:true}).waitFor();
 assert.equal(await page.locator('#clientsBody button[data-action="edit"]').count(),3);
 assert.equal(await page.locator('#clientsBody button[data-action="deactivate"]').count(),2);
 assert.equal(await page.locator('#clientsBody button[data-action="reactivate"]').count(),1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const output=process.env.RHO_PREVIEW_OUTPUT;
 if(output){await page.screenshot({path:output,fullPage:true});}
 await page.getByRole('button',{name:'Editar a Cliente de ejemplo 01',exact:true}).click();
 await page.getByLabel('Nombre completo',{exact:true}).fill('Cliente Actualizado');
 await page.getByLabel('Correo de acceso',{exact:true}).fill('actualizado@example.test');
 assert.equal(await page.locator('[name="confirm_email_change"]').isVisible(),true);
 await page.locator('[name="confirm_email_change"]').check();
 await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();
 await page.getByText('Datos del cliente actualizados.',{exact:true}).waitFor();
 assert.equal(await page.getByText('Cliente Actualizado',{exact:true}).count(),1);
 let row=page.locator('#clientsBody tr').filter({hasText:'Cliente Actualizado'});
 await row.getByRole('button',{name:'Dar de baja',exact:true}).click();
 await page.getByLabel('Motivo de la baja').fill('Registro duplicado de prueba');
 await page.locator('[name="confirm"]').check();
 await page.getByRole('button',{name:'Confirmar baja',exact:true}).click();
 await page.getByText('Cuenta dada de baja. Su historial se conserva.',{exact:true}).waitFor();
 await row.getByRole('button',{name:'Reactivar',exact:true}).click();
 await page.locator('[name="confirm"]').check();
 await page.getByRole('button',{name:'Reactivar cuenta',exact:true}).click();
 await page.getByText('Cuenta reactivada.',{exact:true}).waitFor();
 await page.evaluate(()=>window.previewFailure=true);
 await row.getByRole('button',{name:'Editar a Cliente Actualizado',exact:true}).click();
 await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();
 await page.getByText('Ese correo ya pertenece a otra cuenta de RHO.',{exact:true}).waitFor();
 assert.equal(await page.locator('dialog').isVisible(),true);
 assert.equal(await page.getByRole('button',{name:'Guardar cambios',exact:true}).isEnabled(),true);
 await page.getByRole('button',{name:'Cancelar',exact:true}).click();
 await page.locator('#customerFilter').selectOption('inactive');
 await page.waitForFunction(()=>document.querySelectorAll('#clientsBody tr').length===1);
 assert.match(await page.locator('#clientsBody').innerText(),/Cliente de ejemplo 03/);
 await page.locator('#customerFilter').selectOption('all');
 await page.locator('#customerSearch').fill('Servicios Demo');
 await page.waitForFunction(()=>document.querySelector('#clientsBody').textContent.includes('cliente02@example.test')&&!document.querySelector('#clientsBody').textContent.includes('cliente03@example.test'));
 await page.setViewportSize({width:1280,height:1000});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);
 console.log('PASS mobile/desktop layout, protected admin, edit/email confirmation, deactivate/reactivate, errors, search and filters; no production requests');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
