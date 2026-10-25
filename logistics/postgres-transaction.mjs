// Accepts a node-postgres compatible pool; credentials stay in the server.
export function postgresTransaction(pool) {
 if(typeof pool?.connect!=='function') throw Error('PostgreSQL pool required');
 return async fn=>{
  const client=await pool.connect();
  let broken;
  try {
   await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
   await client.query("SET LOCAL lock_timeout = '5s'");
   await client.query("SET LOCAL statement_timeout = '15s'");
   const result=await fn(client);
   await client.query('COMMIT');
   return result;
  } catch(error) {
   try {await client.query('ROLLBACK');} catch(rollbackError) {broken=rollbackError;}
   // Do not retry here: a lost COMMIT response can mean it already committed.
   throw error;
  } finally {client.release(broken);}
 };
}
