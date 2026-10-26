import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
test('offline dump adapter joins disk-indexed authors, tags curated titles and skips unresolved works',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'shelfchat-dump-'));
  try {
    const authors=join(dir,'authors.gz'),works=join(dir,'works.gz'),output=join(dir,'books.jsonl');
    const line=o=>`/type/record\t${o.key}\t1\t2026-01-01\t${JSON.stringify(o)}\n`;
    await writeFile(authors,gzipSync(line({key:'/authors/OL1A',name:'Rebecca Yarros'})));
    await writeFile(works,gzipSync([
      {key:'/works/OL1W',title:'Unresolved',authors:[{author:{key:'/authors/missing'}}]},
      {key:'/works/OL2W',title:'Fourth Wing',authors:[{author:{key:'/authors/OL1A'}}],subjects:['Romantic fantasy']},
      {key:'/works/OL3W',title:'A second work',authors:[{author:{key:'/authors/OL1A'}}],subjects:['Nonfiction']},
    ].map(line).join('')));
    const result=spawnSync(process.execPath,['scripts/prepare-openlibrary.mjs','--authors',authors,'--works',works,'--index',join(dir,'authors.sqlite'),'--output',output,'--limit','2'],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const rows=(await readFile(output,'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(rows.length,2);
    assert.equal(rows[0].author,'Rebecca Yarros');
    assert.ok(rows[0].tags.includes('booktok'));
    assert.equal(rows[0].availability,'discovery');
    assert.equal(rows[0].url,null);
    assert.equal(rows[1].category,'Nonfiction');
    assert.match(result.stdout,/"skipped":1/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
