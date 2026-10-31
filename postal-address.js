import {postalOptions} from './postal-address-model.js?v=20261031';

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

export function setupPostalAddress({form,onChange,load=loadCatalog}) {
  const postal=form.elements.postal,municipality=form.elements.municipality,settlement=form.elements.settlement;
  const select=document.getElementById('postal-settlement-choice'),label=document.getElementById('postal-settlement-label');
  const status=document.getElementById('postal-address-status'),manual=document.getElementById('postal-manual');
  let revision=0,options=[];
  function reset() {
    revision++; options=[];postal.setCustomValidity('');
    municipality.value='';settlement.value='';municipality.readOnly=true;settlement.readOnly=true;
    settlement.hidden=false;settlement.required=true;select.hidden=true;select.disabled=true;select.required=false;
    select.replaceChildren(new Option('Selecciona tu colonia',''));label.htmlFor=settlement.id;
    status.textContent='Escribe los cinco dígitos del código postal.';manual.hidden=true;
  }
  function manualEntry(message) {
    revision++;options=[];postal.setCustomValidity('');
    municipality.readOnly=false;settlement.readOnly=false;settlement.hidden=false;settlement.required=true;
    select.hidden=true;select.disabled=true;select.required=false;label.htmlFor=settlement.id;
    status.textContent=message;manual.hidden=true;onChange();
  }
  async function lookup() {
    reset();onChange();
    const code=postal.value,attempt=revision;
    if (!/^\d{5}$/.test(code)) return;
    const cdmx=Number(code)>=1000 && Number(code)<17000;
    form.elements.destination.value=cdmx?'cdmx':'other';form.elements.state.value='';onChange();
    if (!cdmx) {
      manualEntry('El autocompletado disponible cubre CDMX. Completa estado, municipio y colonia para que RHO revise tu entrega.');return;
    }
    status.textContent='Buscando colonia y alcaldía…';postal.setCustomValidity('Espera a que termine la consulta del código postal.');
    try {
      const catalog=await load();
      if (attempt!==revision || postal.value!==code) return;
      options=postalOptions(catalog,code);
      if (!options.length) {manualEntry('No encontramos este código postal en el catálogo de CDMX. Revísalo o completa municipio y colonia manualmente.');return;}
      postal.setCustomValidity('');
      const municipalities=[...new Set(options.map(option=>option.municipality))];
      municipality.value=municipalities.length===1?municipalities[0]:'';
      if (options.length===1) {
        settlement.value=options[0].settlement;status.textContent='Colonia y alcaldía completadas.';
      } else {
        settlement.hidden=true;settlement.required=false;select.hidden=false;select.disabled=false;select.required=true;label.htmlFor=select.id;
        select.replaceChildren(new Option('Selecciona tu colonia',''),...options.map(option=>new Option(option.settlement+(municipalities.length>1?' · '+option.municipality:''),option.key)));
        status.textContent=`Este código postal tiene ${options.length} colonias. Selecciona la tuya.`;
      }
      manual.hidden=false;onChange();
    } catch {
      if (attempt!==revision || postal.value!==code) return;
      manualEntry('No pudimos consultar el catálogo postal. Completa municipio y colonia manualmente.');
    }
  }
  postal.addEventListener('input',lookup);
  postal.addEventListener('change',()=>{if(/^\d{5}$/.test(postal.value) && !municipality.value && !settlement.value && select.hidden)lookup();});
  select.addEventListener('change',()=>{
    const chosen=options.find(option=>option.key===select.value);
    settlement.value=chosen?.settlement||'';
    const names=[...new Set(options.map(option=>option.municipality))];
    municipality.value=chosen?.municipality||(names.length===1?names[0]:'');
    status.textContent=chosen?'Colonia y alcaldía completadas.':'Selecciona tu colonia.';onChange();
  });
  manual.addEventListener('click',()=>{
    manualEntry('Completa o corrige el municipio y la colonia. RHO verificará el domicilio antes de confirmar la entrega.');settlement.focus();
  });
  form.elements.destination.addEventListener('change',()=>{postal.value='';reset();onChange();});
  reset();if(/^\d{5}$/.test(postal.value))lookup();
  return {reset};
}
