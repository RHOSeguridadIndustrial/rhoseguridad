// Rules must come from the selected carrier/service, verified server-side.
const positive=x=>Number.isFinite(x)&&x>0;
export function packageFit(parcel,rules) {
 const bad=reason=>({accepted:false,reason});
 if(!parcel||!['weightKg','lengthCm','widthCm','heightCm'].every(k=>positive(parcel[k])))
  return bad('package_measurements_required');
 if(rules?.verified!==true||!['actual','max_actual_volumetric'].includes(rules.weightMethod)||
    !['maxActualKg','maxBillableKg','maxLongestCm','maxMiddleCm','maxShortestCm','roundingKg'].every(k=>positive(rules[k])))
  return bad('package_rules_required');
 const dims=[parcel.lengthCm,parcel.widthCm,parcel.heightCm].sort((a,b)=>b-a);
 if(dims.some((d,i)=>d>[rules.maxLongestCm,rules.maxMiddleCm,rules.maxShortestCm][i])||parcel.weightKg>rules.maxActualKg)
  return bad('package_exceeds_service_limits');
 const volumeCm3=parcel.lengthCm*parcel.widthCm*parcel.heightCm;
 if(!positive(volumeCm3)) return bad('invalid_package_volume');
 let volumetricKg=null;
 if(rules.weightMethod==='max_actual_volumetric') {
  if(!positive(rules.volumetricDivisor)) return bad('volumetric_divisor_required');
  volumetricKg=volumeCm3/rules.volumetricDivisor;
 }
 const raw=Math.max(parcel.weightKg,volumetricKg??0);
 const billableKg=Math.ceil(raw/rules.roundingKg)*rules.roundingKg;
 if(!positive(billableKg)||billableKg>rules.maxBillableKg) return bad('package_exceeds_billable_limit');
 return {accepted:true,volumeCm3,volumetricKg,billableKg};
}
