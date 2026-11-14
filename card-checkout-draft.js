import {cardInput} from './card-checkout-model.js?v=20261106';
const key=id=>'rho-card-delivery-draft:'+id;
export function saveDeliveryDraft(storage,owner,input,now=Date.now()){
 if(!owner)return;
 storage.setItem(key(owner),JSON.stringify({owner,savedAt:now,input:cardInput(input)}));
}
export function takeDeliveryDraft(storage,owner,items,now=Date.now()){
 if(!owner)return null;
 const raw=storage.getItem(key(owner));if(!raw)return null;
 storage.removeItem(key(owner));
 try{
  const draft=JSON.parse(raw);
  if(draft.owner!==owner||!Number.isFinite(draft.savedAt)||now<draft.savedAt||now-draft.savedAt>30*60*1000)return null;
  const input=cardInput(draft.input);
  if(JSON.stringify(input.items)!==JSON.stringify(cardInput({...input,items}).items))return null;
  return input;
 }catch{return null;}
}
