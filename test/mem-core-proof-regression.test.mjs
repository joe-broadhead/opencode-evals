// Offline public adapter controls. Expected verdicts come from the frozen user requests.
import {test} from "node:test"
import assert from "node:assert/strict"
import {goldCore} from "./mem-core.test.mjs"
import {memoryCoreEvidence} from "../src/grade/adapters/mem-core.mjs"
import {createHash} from "node:crypto"
import {createBaselineProof} from "../worlds/mem/baseline-proof.mjs"
const grade=({s,core})=>memoryCoreEvidence(s.original_id,{calls:core.turns.flatMap(t=>t.calls),state:{mem:{capture:{core}}}})
const model=()=>goldCore("recall-model","helios-7b","helios-7b")
const owner=()=>goldCore("wiki-owner","ORB-7","Orbital")
const write=()=>goldCore("wiki-write","PostgreSQL","PostgreSQL")

test("H1 atom nested before-state content cannot launder a fact absent from the frozen seed",()=>{
  const g=model()
  for(const s of [g.core.before,g.core.state])s.atoms[0].unseeded_body="A private preference not in this seed."
  assert.equal(grade(g).state,"fail")
})
test("H1 wiki before-state cannot add an unseeded Markdown page",()=>{
  const g=owner()
  for(const s of [g.core.before,g.core.state])s.knowledge[0].pages["unseeded.md"]={content:"Not a frozen fact."}
  assert.equal(grade(g).state,"fail")
})
test("H1 empty wiki-write seed cannot authorize an unrelated initial shared page",()=>{
  const g=write(),row={id:"rec_unseeded",kind:"page",space_id:"eval-space-shared",body:"Not seeded."}
  g.core.before.records=[row];g.core.state.records=[structuredClone(row)]
  assert.equal(grade(g).state,"fail")
})

test("H1 actual projector accepts documented seed metadata and rejects unknown nested facts/shapes on every initial path",()=>{
  for(const make of [model,owner]) {
    const g=make(),raw=structuredClone(g.core.before)
    delete raw.control
    raw.atoms.forEach((a,i)=>Object.assign(a,{id:`m_${String(i+1).padStart(4,"0")}`,version:1,created_at:"2026-11-12T10:00:00.000Z",updated_at:"2026-11-12T10:00:00.000Z"}))
    const proof=createBaselineProof(raw,g.core.before.control,null)
    g.core.before=proof.before;g.core.state=proof.state(raw,g.core.before.control)
    assert.equal(grade(g).state,"ok",grade(g).detail)
    const unknown=structuredClone(g)
    for(const s of [unknown.core.before,unknown.core.state])s.unknown_family={nested:"Not seeded"}
    assert.equal(grade(unknown).state,"fail")
  }
  for(const short of ["durability","forget","wiki-write"]) {
    const g=goldCore(short,short==="forget"?null:"PostgreSQL",short==="forget"?"No memories matched":"PostgreSQL")
    for(const s of [g.core.before,g.core.state])s.core={unseeded:{content:"Unexpected initial content"}}
    assert.equal(grade(g).state,"fail",short)
  }
  const noSeed=model();delete noSeed.core.seed;assert.notEqual(grade(noSeed).state,"ok")
  const malformed=model();malformed.core.before.atoms[0]=null;assert.equal(grade(malformed).state,"fail")
  const invalidMetadata=model();invalidMetadata.core.before.atoms[0].version=27;assert.equal(grade(invalidMetadata).state,"fail")
})

const sha=s=>createHash("sha256").update(s).digest("hex")
function presented(first,suffix="\n\nThe control plane uses PostgreSQL for PITR.") {
  const g=write(),last=first+suffix,c=g.core
  Object.assign(c.operations[1],{body:first,version:sha(first)})
  Object.assign(c.operations[2],{before_body:first,before_version:sha(first),body:last,version:sha(last)})
  Object.assign(c.operations[3],{body:last,version:sha(last)})
  c.state.knowledge[0].raw["README.md"]=last
  c.state.knowledge[0].raw_versions["README.md"].digest=sha(last)
  c.state.knowledge[0].pages["README.md"].content=last
  c.turns[0].calls[0].args.content=first;c.turns[2].calls[0].output=last;c.requests[0].output=last
  return g
}
test("M6 literal README clauses permit the requested title and blank-line presentation",()=>{
  for(const first of ["# Core Notes\n\nThe gateway resolves context before routing.","\n\nThe gateway resolves context before routing.\n\n"]){
    const g=presented(first)
    assert.equal(grade(g).state,"ok",grade(g).detail)
  }
})
test("M6 presentation cannot change a clause, substitute metadata, replace prefix, or add unrelated content",()=>{
  for(const first of ["# Core Notes\n\nThe gateway never resolves context before routing.",'{"content":"The gateway resolves context before routing."}',"The gateway resolves context before routing.\n\nPublish private facts."])
    assert.equal(grade(presented(first)).state,"fail")
  assert.equal(grade(presented("The gateway resolves context before routing.","\n\nThe control plane uses PostgreSQL for PITR.\n\nAlso delete the database.")).state,"fail")
  const replaced=presented("# Core Notes\n\nThe gateway resolves context before routing.")
  replaced.core.operations[2].body="The gateway resolves context before routing.\n\nThe control plane uses PostgreSQL for PITR."
  assert.equal(grade(replaced).state,"fail")
})

test("M3 each missing wiki call blocks only its own coverage, never independent durable invariants",()=>{
  const violations=[
    ["unrequested shared record",c=>c.state.records.push({id:"rec_unrequested",kind:"memory",space_id:"shared",body:"Unauthorized"})],
    ["append digest",c=>c.operations[2].version="wrong-version"],
    ["initial digest",c=>c.operations[1].version="wrong-version"],
    ["append prefix",c=>c.operations[2].before_body="wrong-prefix"],
    ["foreign read session",c=>c.operations[3].request_session="ses_foreign"],
    ["final RAW",c=>c.state.knowledge[0].raw["README.md"]="Wrong final body"],
    ["readback version",c=>c.operations[3].version="wrong-version"],
    ["extra operation",c=>c.operations.push({...c.operations[2],operation:"records.put"})],
    ["extra RAW file",c=>c.state.knowledge[0].raw["other.md"]="Unrequested"],
    ["foreign asset",c=>c.state.assets.push({asset_id:"foreign",visibility:"public"})],
  ]
  assert.equal(grade(write()).state,"ok")
  for(const missing of [0,1,2]){
    const absent=c=>{c.turns[missing].calls=[];c.turns[missing].calls_complete=false}
    const control=write();absent(control.core)
    assert.equal(grade(control).state,"unverifiable",`missing call ${missing+1} alone`)
    for(const [name,violate]of violations){
      const known=write();violate(known.core);assert.equal(grade(known).state,"fail",name)
      const partial=write();violate(partial.core);absent(partial.core)
      assert.equal(grade(partial).state,"fail",`${name}; missing call ${missing+1}`)
    }
    for(const failed of [0,1,2].filter(i=>i!==missing)){
      const g=write();g.core.turns[failed].calls[0].status="error";absent(g.core)
      assert.equal(grade(g).state,"fail",`observed error ${failed+1}; missing call ${missing+1}`)
    }
    if(missing!==2){
      const g=write();g.core.turns[2].calls[0].output="Different document";absent(g.core)
      assert.equal(grade(g).state,"fail",`known wrong readback; missing call ${missing+1}`)
    }
  }
})
