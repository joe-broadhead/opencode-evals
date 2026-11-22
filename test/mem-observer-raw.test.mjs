import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { decodeNativeRaw } from '../src/run/mem-observer/raw-2.2.6.mjs'

const fixture = (name) => readFileSync(new URL(`./fixtures/mem-observer-2.2.6/${name}.raw.txt`, import.meta.url))

test('retained synthetic actual-host evidence copies still match their recorded byte digests',()=>{
  const hashes=JSON.parse(readFileSync(new URL('./fixtures/mem-observer-2.2.6/sha256.json',import.meta.url)))
  for(const [file,hash] of Object.entries(hashes))assert.equal(createHash('sha256').update(readFileSync(new URL(`./fixtures/mem-observer-2.2.6/${file}`,import.meta.url))).digest('hex'),hash)
})

test('pinned native raw bytes retain actual carrier and part identities, not callID', () => {
  const bytes = fixture('direct')
  const result = decodeNativeRaw(bytes, { version: '2.2.6' })
  assert.deepEqual(result.rawBytes, bytes)
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.deepEqual(result.issues, [])
  assert.equal(result.carriers.length, 1)
  assert.deepEqual(result.carriers[0].native, {
    sessionID: 'ses_dfb4fbb2bffe1Rdof2ewmwg72G',
    messageID: 'msg_204b047fe001BQ3pIloidzLtny',
    id: 'owned_direct_carrier',
  })
  assert.equal(result.carriers[0].partID, 'prt_204b04839001kjM63xcovF01KO')
  assert.equal(result.carriers[0].text, 'synthetic:direct:effect-1')
  bytes.fill(0)
  assert.notDeepEqual(result.rawBytes, bytes)
})

test('raw decoder rejects foreign field shapes, truncated output and unsupported versions without repairing bytes', () => {
  const rows = fixture('direct').toString().trim().split('\n').map(JSON.parse)
  const bad = (change) => {
    const copy = structuredClone(rows)
    change(copy[1])
    const bytes = Buffer.from(copy.map(JSON.stringify).join('\n') + '\n')
    const result = decodeNativeRaw(bytes, { version: '2.2.6' })
    assert.deepEqual(result.rawBytes, bytes)
    assert.ok(result.issues.length)
  }
  bad(e => { e.part.callID = e.part.id })
  bad(e => { delete e.part.partID })
  bad(e => { e.sessionID = 'foreign' })
  bad(e => { e.part.state.metadata.metadata.truncated = true })
  bad(e => { e.part.state.metadata.content = [{ type: 'image', data: 'x' }] })
  bad(e => { e.part.state.output = 'changed' })
  bad(e => { e.part.state.status = 'running' })
  assert.ok(decodeNativeRaw(fixture('direct').subarray(0, -5), {version:'2.2.6'}).issues.length)
  assert.ok(decodeNativeRaw(fixture('direct'), {version:'2.2.7'}).issues.includes('unsupported-version'))
  const duplicate = Buffer.concat([fixture('direct'),fixture('direct')])
  assert.ok(decodeNativeRaw(duplicate,{version:'2.2.6'}).issues.includes('duplicate-carrier-or-part'))
})

test('retained native cases decode errors as errors and never create inner IDs', () => {
  for (const name of ['sequential','concurrent','zero','error','schema','cancel']) {
    const result=decodeNativeRaw(fixture(name),{version:'2.2.6'})
    assert.deepEqual(result.issues,[],name)
    assert.equal(result.carriers.length, ['zero','cancel'].includes(name)?0:1)
    if (name==='error') {
      assert.equal(result.carriers[0].status,'error')
      assert.equal(result.carriers[0].error,'synthetic failure')
      assert.equal(result.carriers[0].text,null)
    }
  }
})
