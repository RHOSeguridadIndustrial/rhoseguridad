export class ExpiredTestTransfer extends Error {}

export function testCheckoutRpc(service) {
 return async(name,args)=>{
  const {data,error}=await service.rpc(name,args);
  if(error){
   if(error.code==='PQT01' && ['qw10_test_load_reservation','qw10_test_reserve_v2'].includes(name))
    throw new ExpiredTestTransfer('Expired unpaid test transfer');
   throw Error('Test database error');
  }
  return data;
 };
}
