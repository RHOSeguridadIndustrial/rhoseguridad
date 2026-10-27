import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import test from 'node:test';
const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root),'utf8');
test('retired endpoint cannot confirm any user, including the old matching nonce',async()=>{
  let handler;
  const context={Deno:{serve:fn=>handler=fn},Request,Response,Set};
  vm.runInNewContext(stripTypeScriptTypes(read('supabase/functions/complete-registration/index.ts')),context);
  for(const body of [{},{user_id:'11111111-1111-4111-8111-111111111111',email:'test@example.invalid',nonce:'a'.repeat(64)}]){
    const response=await handler(new Request('https://test.invalid',{method:'POST',body:JSON.stringify(body)}));
    assert.equal(response.status,410);
    assert.equal((await response.json()).error,'email_verification_required');
  }
  const response=await handler(new Request('https://test.invalid',{method:'OPTIONS',headers:{Origin:'https://untrusted.invalid'}}));
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
});
async function registrationCase(result,throws=false){
 let submit,called,reset=false,signedOut=false;
 const button={disabled:false};const status={};const contact={hidden:true};
 const form={hidden:false,querySelector:()=>button,addEventListener:(_,fn)=>submit=fn,reset:()=>reset=true};
 const fields=new Map(Object.entries({email:' Test@Example.invalid ',password:'synthetic-password',nombre:'Prueba',apellidos:'RHO',empresa:'',telefono:'',tipo:'Empresa'}));
 const supabase={auth:{signUp:async args=>{called=args;if(throws)throw Error('network');return result;},signOut:async()=>{signedOut=true;}}};
 vm.runInNewContext(read('registration.js').replace(/^import .*;\n/,''),{supabase,document:{getElementById:id=>({registerForm:form,status,contactOptions:contact}[id])},FormData:class{get(k){return fields.get(k);}}});
 await submit({preventDefault(){}});return {called,reset,signedOut,form,status,button,contact};
}
test('pending email stays pending, clears password and does not use nonce or auto-login',async()=>{
 const r=await registrationCase({data:{user:{id:'test'},session:null},error:null});
 assert.equal(r.called.email,'test@example.invalid');
 assert.equal(r.called.options.data.registration_nonce,undefined);
 assert.equal(r.reset,true);assert.equal(r.form.hidden,true);assert.equal(r.contact.hidden,false);
 assert.match(r.status.textContent,/Revisa tu correo/);
});
test('signup failures preserve form and permit retry',async()=>{
 for(const input of [{data:null,error:{status:429}},{data:null,error:{code:'weak_password'}}]){
  const r=await registrationCase(input);assert.equal(r.form.hidden,false);assert.equal(r.reset,false);assert.equal(r.button.disabled,false);assert.equal(r.status.className,'note error');
 }
 const r=await registrationCase(null,true);assert.equal(r.button.disabled,false);assert.equal(r.form.hidden,false);
});
test('duplicate response does not disclose account existence',async()=>{
 const r=await registrationCase({data:{user:{identities:[]},session:null},error:null});assert.match(r.status.textContent,/Si ya tienes una cuenta/);
});
test('CSP allows all exact inline scripts and excludes inline handlers',()=>{
 for(const file of ['login.html','registro.html']){
  const html=read(file);const policy=html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)[1].replaceAll('&#x27;',"'");
  for(const [,attrs,code] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){
   if(!/\bsrc\s*=/.test(attrs))assert.ok(policy.includes('sha256-'+createHash('sha256').update(code).digest('base64')));
  }
  assert.equal(/\son[a-z]+\s*=/i.test(html),false);
  assert.ok(!policy.split('script-src')[1].split(';')[0].includes('unsafe-inline'));
 }
});
