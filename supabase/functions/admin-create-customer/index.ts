import { requireAdminSession } from '../_shared/admin-auth.js';
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.4";

const allowedOrigins=new Set([
  "https://rhosegind.com",
  "https://www.rhosegind.com",
  "https://rhoseguridadindustrial.github.io"
]);

function cors(request:Request){
  const origin=request.headers.get("Origin")||"";
  const allow=allowedOrigins.has(origin)?origin:"https://rhosegind.com";
  return {
    "Access-Control-Allow-Origin":allow,
    "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Vary":"Origin",
    "Cache-Control":"no-store",
    "Content-Type":"application/json; charset=utf-8"
  };
}

Deno.serve(async(request:Request)=>{
  const headers=cors(request);
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(request.method==="OPTIONS") return new Response("ok",{headers});
  if(request.method!=="POST") return json({error:"Método no permitido"},405);

  const origin=request.headers.get("Origin")||"";
  if(origin && !allowedOrigins.has(origin)) return json({error:"Origen no permitido"},403);
  if(Number(request.headers.get("content-length")||0)>16384) return json({error:"Solicitud demasiado grande"},413);

  const authHeader=request.headers.get("Authorization")||"";
  const jwt=authHeader.replace(/^Bearer\s+/i,"");
  if(!jwt) return json({error:"Sesión de administrador requerida"},401);

  const service=createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    {auth:{persistSession:false,autoRefreshToken:false}}
  );

  const {data:authData,error:authError}=await service.auth.getUser(jwt);
  if(authError||!authData.user) return json({error:"Sesión inválida"},401);

  const {data:adminProfile,error:adminProfileError}=await service
    .from("profiles").select("role").eq("id",authData.user.id).maybeSingle();
  if(adminProfileError||adminProfile?.role!=="admin") return json({error:"Acceso de administrador requerido"},403);

  if (!(await requireAdminSession(jwt))) return json({error:"Verifica tu código de administrador antes de continuar.",code:"mfa_required"},403);

  let payload:Record<string,unknown>;
  try{payload=await request.json();}catch{return json({error:"Solicitud inválida"},400);}

  const fullName=String(payload.full_name||"").trim().replace(/\s+/g," ").slice(0,160);
  const email=String(payload.email||"").trim().toLowerCase().slice(0,254);
  const companyName=String(payload.company_name||"").trim().replace(/\s+/g," ").slice(0,160);
  const phone=String(payload.phone||"").trim().slice(0,40);
  const customerType=String(payload.customer_type||"Empresa").trim().slice(0,40);
  const allowedTypes=new Set(["Empresa","Contratista","Particular","Distribuidor"]);

  if(fullName.length<3) return json({error:"Captura el nombre completo del cliente."},400);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({error:"Captura un correo electrónico válido."},400);
  if(phone && !/^[0-9+()\-\s.]{7,40}$/.test(phone)) return json({error:"Captura un teléfono válido."},400);
  if(!allowedTypes.has(customerType)) return json({error:"Tipo de cliente inválido."},400);

  const {data:existing}=await service.auth.admin.listUsers({page:1,perPage:1000});
  const duplicate=(existing?.users||[]).find(u=>u.email?.toLowerCase()===email);
  if(duplicate) return json({error:"Ese correo ya está registrado como cliente o usuario de RHO.",code:"duplicate_email"},409);

  const {data,error}=await service.auth.admin.inviteUserByEmail(email,{
    redirectTo:"https://rhosegind.com/establecer-password.html",
    data:{
      full_name:fullName,
      company_name:companyName||null,
      phone:phone||null,
      customer_type:customerType,
      created_by_admin:true
    }
  });

  if(error||!data.user){
    const message=error?.message||"";
    const duplicateError=/already|registered|exists/i.test(message);
    return json({
      error:duplicateError?"Ese correo ya está registrado como cliente o usuario de RHO.":"No fue posible crear e invitar al cliente.",
      code:duplicateError?"duplicate_email":"invite_failed"
    },duplicateError?409:400);
  }

  const {error:auditError}=await service.from("customer_admin_audit").insert({
    admin_user_id:authData.user.id,
    customer_user_id:data.user.id,
    action:"create_customer",
    customer_email:email,
    metadata:{
      full_name:fullName,
      company_name:companyName||null,
      phone:phone||null,
      customer_type:customerType
    }
  });
  if(auditError) console.error("customer_admin_audit",auditError.message);

  return json({
    created:true,
    invited:true,
    customer:{
      id:data.user.id,
      full_name:fullName,
      email,
      company_name:companyName||null,
      phone:phone||null,
      customer_type:customerType
    },
    message:"Cliente creado. Se envió una invitación al correo para establecer su contraseña."
  },201);
});
