// Public postal names suggest an address; they do not confirm delivery coverage.
export function postalOptions(catalog, postalCode) {
  if (typeof postalCode !== 'string' || !/^\d{5}$/.test(postalCode)) throw new Error('invalid_postal_code');
  if (catalog?.country !== 'MX') throw new Error('invalid_postal_catalog');
  let rows;
  if (catalog.schemaVersion===2 && catalog.postalCode===postalCode) rows=catalog.options;
  else if (catalog.schemaVersion===1 && catalog.state==='CMX' && catalog.postcodes && catalog.municipalities) {
    const legacy=catalog.postcodes[postalCode];
    if(legacy===undefined)return [];
    if(!Array.isArray(legacy))throw new Error('invalid_postal_options');
    rows=legacy.map(row=>{
      if(!Array.isArray(row)||row.length!==3||!/^\d{3}$/.test(row[0])||!/^\d{4}$/.test(row[1]))throw new Error('invalid_postal_option');
      return {key:'09'+row[0]+':'+row[1],postalCode,stateCode:'09',state:'Ciudad de México',municipality:catalog.municipalities[row[0]],settlement:row[2]};
    });
  } else throw new Error('invalid_postal_catalog');
  if (!Array.isArray(rows) || rows.length > 500) throw new Error('invalid_postal_options');
  const seen = new Set(), keys = new Set(), options = [];
  for (const row of rows) {
    if(!row || typeof row!=='object')throw new Error('invalid_postal_option');
    const {key,stateCode,state,municipality,settlement}=row;
    if (row.postalCode!==postalCode || typeof key!=='string' || !/^\d{5}:\d{4}$/.test(key) ||
        typeof stateCode!=='string' || !/^\d{2}$/.test(stateCode) || Number(stateCode)<1 || Number(stateCode)>32 || !key.startsWith(stateCode) ||
        typeof state!=='string' || !state.trim() || state.length>80 ||
        typeof settlement !== 'string' || !settlement.trim() || settlement.length > 150 ||
        typeof municipality !== 'string' || !municipality.trim() || municipality.length > 100)
      throw new Error('invalid_postal_option');
    if (keys.has(key)) throw new Error('duplicate_postal_option');
    keys.add(key);
    const labelKey = state + '\n' + municipality + '\n' + settlement;
    if (seen.has(labelKey)) continue;
    seen.add(labelKey);options.push({key,postalCode,stateCode,state,municipality,settlement});
  }
  return options.sort((a,b)=>a.settlement.localeCompare(b.settlement,'es') || a.municipality.localeCompare(b.municipality,'es'));
}
