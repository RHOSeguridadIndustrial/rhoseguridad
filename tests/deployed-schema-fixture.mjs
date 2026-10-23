// Schema-only snapshot from the official Supabase connector; no remote rows/secrets.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const source = new URL('./fixtures/qw10-deployed-schema-20261023.json', import.meta.url);
const raw = await readFile(source, 'utf8');
export const snapshot = JSON.parse(raw);
export const snapshotHash = createHash('sha256').update(raw).digest('hex');
const ident = value => '"'+value.replaceAll('"','""')+'"';
export function deployedFixture() {
  if (snapshot.metadata.triggers !== null) throw Error('Review newly captured triggers before exporting');
  const sql = ['-- DISPOSABLE DATABASE ONLY. Never apply this fixture to Supabase.',
    'create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;',
    'create schema qw10_test; revoke all on schema qw10_test from public,anon,authenticated; grant usage on schema qw10_test to service_role;'];
  for (const t of snapshot.tables) {
    const cols = t.columns.map(c => `${ident(c.name)} ${c.type}${c.identity ? ' generated '+(c.identity==='a'?'always':'by default')+' as identity' : c.default ? ' default '+c.default : ''}${c.notnull ? ' not null' : ''}`);
    sql.push(`create table qw10_test.${ident(t.relname)} (${cols.join(',')});`);
  }
  // Referenced uniqueness must exist before foreign keys.
  for (const foreign of [false,true]) for (const t of snapshot.tables) for(const c of t.constraints||[]) {
    if ((c.type==='f')===foreign) sql.push(`alter table qw10_test.${ident(t.relname)} add constraint ${ident(c.name)} ${c.definition};`);
  }
  for (const idx of snapshot.metadata.indexes) sql.push(idx.definition+';');
  const privileges = {a:'insert',r:'select',w:'update',d:'delete',D:'truncate',x:'references',t:'trigger'};
  for (const t of snapshot.tables) {
    sql.push(`revoke all on qw10_test.${ident(t.relname)} from public,anon,authenticated,service_role;`);
    if (t.relrowsecurity) sql.push(`alter table qw10_test.${ident(t.relname)} enable row level security;`);
    const acl=t.relacl.match(/service_role=([a-zA-Z]+)\//)?.[1];
    if (acl) sql.push(`grant ${[...acl].map(c=>{if(!privileges[c])throw Error('Unknown privilege');return privileges[c];}).join(',')} on qw10_test.${ident(t.relname)} to service_role;`);
  }
  sql.push('grant select,usage on sequence qw10_test.purchase_orders_id_seq to service_role;');
  const functions=[...snapshot.functions].sort((a,b)=>(a.nspname==='qw10_test'?-1:0)-(b.nspname==='qw10_test'?-1:0));
  for (const f of functions) sql.push(f.definition+';');
  for (const f of snapshot.functionPermissions.filter(p=>snapshot.functions.some(x=>x.nspname===p.nspname&&x.proname===p.proname))) {
    if(f.prosecdef || f.proacl!=='{postgres=X/postgres,service_role=X/postgres}') throw Error('Unexpected function permissions');
    sql.push(`revoke all on function ${f.nspname}.${f.proname}(${f.args}) from public,anon,authenticated,service_role; grant execute on function ${f.nspname}.${f.proname}(${f.args}) to service_role;`);
  }
  return sql.join('\n');
}
