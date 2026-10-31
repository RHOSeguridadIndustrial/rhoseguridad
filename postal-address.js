import {postalOptions} from './postal-address-model.js?v=20261031-mx';

let catalogPromise;
function loadCatalog() {
  if (!catalogPromise) catalogPromise = (async()=>{
    const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),10000);
    try {
      const response = await fetch('./assets/postal-cdmx.json?v=20261025',{signal:controller.signal,credentials:'omit'});
      if (!response.ok) throw new Error('postal_catalog_unavailable');
      const catalog = await response.json();
      postalOptions(catalog,'02140');
      return catalog;
    } finally {clearTimeout(timer);}
  })().catch(error=>{catalogPromise=undefined;throw error;});
  return catalogPromise;
}

const lookups=new Map();
async function loadPostal(code) {
  if(!lookups.has(code)) {
    if(lookups.size>=30)lookups.delete(lookups.keys().next().value);
    const promise=(async()=>{
      let timer;
      try {
        return await Promise.race([(async()=>{
          const {supabase}=await import('./supabase-client.js?v=20260913-loyalty');
          const {data,error}=await supabase.functions.invoke('postal-lookup',{body:{postalCode:code}});
          if(error)throw error;
          postalOptions(data,code);return data;
        })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('postal_timeout')),10000);})]);
      } catch(error) {
        if(Number(code)>=1000&&Number(code)<17000)return loadCatalog();
        throw error;
      } finally {clearTimeout(timer);}
    })().catch(error=>{lookups.delete(code);throw error;});
    lookups.set(code,promise);
  }
  return lookups.get(code);
}

export function setupPostalAddress({form,onChange,load=loadPostal}) {
  const postal=form.elements.postal,state=form.elements.state,municipality=form.elements.municipality,settlement=form.elements.settlement;
  const select=document.getElementById('postal-settlement-choice'),label=document.getElementById('postal-settlement-label');
  const status=document.getElementById('postal-address-status'),manual=document.getElementById('postal-manual');
  let revision=0,options=[];
  function reset() {
    revision++; options=[];postal.setCustomValidity('');
    state.value='';municipality.value='';settlement.value='';state.readOnly=true;municipality.readOnly=true;settlement.readOnly=true;
    settlement.hidden=false;settlement.required=true;select.hidden=true;select.disabled=true;select.required=false;
    select.replaceChildren(new Option('Selecciona tu colonia',''));label.htmlFor=settlement.id;
    status.textContent='Escribe los cinco dígitos del código postal.';manual.hidden=true;
  }
  function manualEntry(message) {
    revision++;options=[];postal.setCustomValidity('');
    state.readOnly=false;municipality.readOnly=false;settlement.readOnly=false;settlement.hidden=false;settlement.required=true;
    select.hidden=true;select.disabled=true;select.required=false;label.htmlFor=settlement.id;
    status.textContent=message;manual.hidden=true;onChange();
  }
  async function lookup() {
    reset();onChange();
    const code=postal.value,attempt=revision;
    if (!/^\d{5}$/.test(code)) return;
    const cdmx=Number(code)>=1000 && Number(code)<17000;
    form.elements.destination.value=cdmx?'cdmx':'other';form.elements.state.value='';onChange();
    status.textContent='Buscando estado, municipio y colonia…';postal.setCustomValidity('Espera a que termine la consulta del código postal.');
    try {
      const catalog=await load(code);
      if (attempt!==revision || postal.value!==code) return;
      options=postalOptions(catalog,code);
      if (!options.length) {manualEntry('No encontramos este código postal. Revísalo o completa estado, municipio y colonia manualmente.');return;}
      postal.setCustomValidity('');
      const municipalities=[...new Set(options.map(option=>option.municipality))];
      const states=[...new Set(options.map(option=>option.state))];
      state.value=states.length===1?states[0]:'';
      form.elements.destination.value=options.every(option=>option.stateCode==='09')?'cdmx':'other';
      municipality.value=municipalities.length===1?municipalities[0]:'';
      if (options.length===1) {
        settlement.value=options[0].settlement;status.textContent='Estado, municipio y colonia completados.';
      } else {
        settlement.hidden=true;settlement.required=false;select.hidden=false;select.disabled=false;select.required=true;label.htmlFor=select.id;
        select.replaceChildren(new Option('Selecciona tu colonia',''),...options.map(option=>new Option(option.settlement+(municipalities.length>1?' · '+option.municipality:'')+(states.length>1?' · '+option.state:''),option.key)));
        status.textContent=`Este código postal tiene ${options.length} colonias. Selecciona la tuya.`;
      }
      manual.hidden=false;onChange();
    } catch {
      if (attempt!==revision || postal.value!==code) return;
      manualEntry('No pudimos consultar el catálogo postal. Completa estado, municipio y colonia manualmente.');
    }
  }
  postal.addEventListener('input',lookup);
  postal.addEventListener('change',()=>{if(/^\d{5}$/.test(postal.value) && !municipality.value && !settlement.value && select.hidden)lookup();});
  select.addEventListener('change',()=>{
    const chosen=options.find(option=>option.key===select.value);
    settlement.value=chosen?.settlement||'';
    const names=[...new Set(options.map(option=>option.municipality))];
    municipality.value=chosen?.municipality||(names.length===1?names[0]:'');
    const states=[...new Set(options.map(option=>option.state))];
    state.value=chosen?.state||(states.length===1?states[0]:'');
    if(chosen)form.elements.destination.value=chosen.stateCode==='09'?'cdmx':'other';
    status.textContent=chosen?'Estado, municipio y colonia completados.':'Selecciona tu colonia.';onChange();
  });
  manual.addEventListener('click',()=>{
    manualEntry('Completa o corrige estado, municipio y colonia. RHO verificará el domicilio antes de confirmar la entrega.');settlement.focus();
  });
  form.elements.destination.addEventListener('change',()=>{postal.value='';reset();onChange();});
  reset();if(/^\d{5}$/.test(postal.value))lookup();
  return {reset};
}
