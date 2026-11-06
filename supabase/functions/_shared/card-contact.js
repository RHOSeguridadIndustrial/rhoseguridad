// Delivery recipient, not a payment identity or an authentication credential.
export function cardContact(value) {
 if(typeof value?.name!=='string'||typeof value?.phone!=='string')throw Error('Invalid card contact');
 const name=value.name.trim().replace(/\s+/gu,' '),phone=value.phone.replace(/[\s()-]/g,'');
 if(name.length<2||name.length>120||/[\p{Cc}\p{Cf}<>]/u.test(name)||!/^\+?[0-9]{10,15}$/.test(phone))throw Error('Invalid card contact');
 return {name,phone};
}
