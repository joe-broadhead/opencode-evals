import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {discoveryCases,renderDiscoveryCase} from '../packs/mem/discovery-plan.mjs';
import {discoveryFlow} from './support/mem-discovery-flow.mjs';
import {compileCase} from '../src/case/compile.mjs';
import {main} from '../src/cli.mjs';

test('CLI preserves absent versus present malformed journals in every case and mode',async()=>{
  const root=mkdtempSync(join(tmpdir(),'discovery-presence-')),cases=join(root,'cases'),traces=join(root,'traces'),raw=join(root,'raw'),native=join(raw,'presence','mem'),out=join(root,'out'),expected=[];
  try{
    for(const dir of [cases,traces,native])mkdirSync(dir,{recursive:true});
    for(const s of discoveryCases){
      writeFileSync(join(cases,s.id+'.md'),renderDiscoveryCase(s));
      writeFileSync(join(cases,s.id+'.json'),JSON.stringify(compileCase(s.id+'.md',renderDiscoveryCase(s))));
      let trial=0;
      for(const mode of ['direct','execute'])for(const value of ['absent','healthy','null','[]','false','7','"journal"','{}','complete-empty','incomplete-empty','future']){
        trial++;
        const f=discoveryFlow(s,mode),base=join(native,`${s.id}.t${trial}`);
        writeFileSync(join(traces,`${s.id}.t${trial}.trace.jsonl`),[f.head,...f.trace].map(JSON.stringify).join('\n'));
        writeFileSync(base+'.jsonl',f.rawLines.join('\n'));
        writeFileSync(base+'.files.json',JSON.stringify([{path:'mem-fixture/capture.json',change:'added',text:JSON.stringify(f.capture)}]));
        writeFileSync(base+'.guard.jsonl',JSON.stringify({kind:'guard_start',case_id:s.id,trial_id:'spec_trial'}));
        // A direct journal uses actual direct IDs; it is not reconstructed from source.
        const journal=f.journal??{schema:'oc-mem-invocations/1',scope:{case_id:s.id,trial,trial_id:'spec_trial',turn:1,session:'ses_spec'},raw_sha256:f.recording.raw_sha256,complete:true,calls:f.rawLines.map(JSON.parse).filter(r=>r.type==='tool_use').map(r=>({call_id:r.part.callID,carrier_call_id:r.part.callID,tool:r.part.tool,args:r.part.state.input,status:r.part.state.status,output:r.part.state.output}))};
        journal.scope.trial=trial;
        if(value.endsWith('-empty')){journal.calls=[];journal.complete=value==='complete-empty'}
        if(value==='future')journal.schema='oc-mem-invocations/2';
        if(value!=='absent')writeFileSync(base+'.mem-invocations.json',['healthy','complete-empty','incomplete-empty','future'].includes(value)?JSON.stringify(journal):value);
        const result=value==='healthy'||value==='absent'&&mode==='direct'?'PASS':value==='future'||value==='incomplete-empty'||value==='{}'||value==='absent'?'BLOCKED':'FAIL';
        expected.push({id:s.id,trial,value,mode,result});
      }
    }
    const log=console.log;try{console.log=()=>{};await main(['grade','--plugin','mem','--cases',cases,'--traces',traces,'--raw',raw,'--out',out,'--iteration','presence'])}finally{console.log=log}
    const results=JSON.parse(readFileSync(join(out,'verdicts.json')));
    assert.equal(results.length,528);
    for(const r of results){const e=expected.find(e=>e.id===r.case&&e.trial===r.trial);assert.equal(r.verdict,e.result,`${e.id} ${e.mode} ${e.value}`)}
  }finally{rmSync(root,{recursive:true,force:true});assert.equal(existsSync(root),false)}
});
