import {PGlite} from '@electric-sql/pglite';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
const db=new PGlite();try{
 await db.exec(await readFile('tests/fixtures/qw10-deployed-schema.sql','utf8'));
 await db.exec(await readFile('supabase/qw10-test-delivery-catalog.sql','utf8'));
 await db.exec("insert into qw10_test.delivery_catalog(catalog_text,pinned_sha256,enabled) values(repeat('x',100),repeat('a',64),true)");
 for(const role of ['anon','authenticated','service_role']){await db.exec('set role '+role);await assert.rejects(db.query('select * from qw10_test.delivery_catalog'),e=>e.code==='42501');if(role!=='service_role')await assert.rejects(db.query('select public.qw10_test_delivery_catalog()'),e=>e.code==='42501');await db.exec('reset role');}
 await db.exec('set role service_role');const r=await db.query('select public.qw10_test_delivery_catalog() d');assert.equal(r.rows[0].d.pinnedSha256,'a'.repeat(64));await db.exec('reset role');
 await db.exec('update qw10_test.delivery_catalog set enabled=false');await db.exec('set role service_role');assert.equal((await db.query('select public.qw10_test_delivery_catalog() d')).rows[0].d,null);
 console.log('PASS catalog RLS, direct-table denial, server-only RPC and disable switch');
}finally{await db.close();}
