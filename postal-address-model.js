// Public postal names suggest an address; they do not confirm delivery coverage.
export function postalOptions(catalog, postalCode) {
  if (typeof postalCode !== 'string' || !/^\d{5}$/.test(postalCode)) throw new Error('invalid_postal_code');
  if (catalog?.schemaVersion !== 1 || catalog.country !== 'MX' || catalog.state !== 'CMX' ||
      !catalog.postcodes || !catalog.municipalities) throw new Error('invalid_postal_catalog');
  const rows = catalog.postcodes[postalCode];
  if (rows === undefined) return [];
  if (!Array.isArray(rows) || rows.length > 500) throw new Error('invalid_postal_options');
  const seen = new Set(), keys = new Set(), options = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 3) throw new Error('invalid_postal_option');
    const [municipalityCode,settlementCode,settlement] = row;
    const municipality = catalog.municipalities[municipalityCode];
    if (typeof municipalityCode !== 'string' || !/^\d{3}$/.test(municipalityCode) ||
        typeof settlementCode !== 'string' || !/^\d{4}$/.test(settlementCode) ||
        typeof settlement !== 'string' || !settlement.trim() || settlement.length > 150 ||
        typeof municipality !== 'string' || !municipality.trim() || municipality.length > 100)
      throw new Error('invalid_postal_option');
    const key = municipalityCode + ':' + settlementCode;
    if (keys.has(key)) throw new Error('duplicate_postal_option');
    keys.add(key);
    const labelKey = municipality + '\n' + settlement;
    if (seen.has(labelKey)) continue;
    seen.add(labelKey);options.push({key,postalCode,municipality,settlement});
  }
  return options.sort((a,b)=>a.settlement.localeCompare(b.settlement,'es') || a.municipality.localeCompare(b.municipality,'es'));
}
