"""Prepare a private cache from the official CPdescargatxt.zip download.

Usage: python scripts/prepare-postal-import.py ZIP OUTPUT_DIRECTORY YYYY-MM-DD
Generated data stays outside the public repository. Import batches with the
project's database management connection, then verify manifest counts.
"""
import base64, collections, csv, datetime, gzip, hashlib, io, json, pathlib, re, sys, zipfile

source, output, updated = sys.argv[1:]
datetime.date.fromisoformat(updated)
out = pathlib.Path(output)
out.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(source) as archive:
    raw = archive.read('CPdescarga.txt')
source_hash = hashlib.sha256(raw).hexdigest()
rows = list(csv.DictReader(io.StringIO('\n'.join(raw.decode('cp1252').splitlines()[1:])), delimiter='|'))
shards = {}
seen = set()
for row in rows:
    cp, state, municipality, settlement = [row[k] for k in ('d_codigo', 'c_estado', 'c_mnpio', 'id_asenta_cpcons')]
    assert all(re.fullmatch(p, v) for p, v in [(r'\d{5}',cp),(r'\d{2}',state),(r'\d{3}',municipality),(r'\d{4}',settlement)])
    municipality = state + municipality
    key = (cp, municipality, settlement)
    assert key not in seen, key
    seen.add(key)
    shard = shards.setdefault(cp[:2], {'states':{}, 'municipalities':{}, 'postcodes':{}})
    shard['states'][state] = row['d_estado']
    shard['municipalities'][municipality] = row['D_mnpio']
    shard['postcodes'].setdefault(cp, []).append([municipality, settlement, row['d_asenta']])
records = []
for prefix, shard in sorted(shards.items()):
    payload = json.dumps(shard, ensure_ascii=False, separators=(',',':')).encode()
    records.append({'prefix':prefix, 'compressed_payload':base64.b64encode(gzip.compress(payload,mtime=0)).decode(), 'source_sha256':source_hash, 'source_updated_on':updated})
    (out / (prefix+'.json')).write_bytes(payload)
for i in range(0,len(records),5):
    batch = json.dumps(records[i:i+5], separators=(',',':'))
    assert '$postal$' not in batch
    sql = "insert into public.checkout_postal_catalog(prefix, compressed_payload, source_sha256, source_updated_on) select prefix, compressed_payload, source_sha256, source_updated_on from jsonb_to_recordset($postal$"+batch+"$postal$::jsonb) as x(prefix text, compressed_payload text, source_sha256 text, source_updated_on date) on conflict(prefix) do update set compressed_payload=excluded.compressed_payload, source_sha256=excluded.source_sha256, source_updated_on=excluded.source_updated_on, loaded_at=now();"
    (out / ('batch-%02d.sql' % (i//5))).write_text(sql)
manifest = {'sourceUrl':'https://www.correosdemexico.gob.mx/SSLServicios/ConsultaCP/CodigoPostal_Exportar.aspx', 'sourceUpdatedOn':updated, 'sourceSha256':source_hash, 'states':len(set(r['c_estado'] for r in rows)), 'postcodes':len(set(r['d_codigo'] for r in rows)), 'settlements':len(rows), 'shards':len(shards), 'compressedCharacters':sum(len(r['compressed_payload']) for r in records)}
(out / 'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest))
