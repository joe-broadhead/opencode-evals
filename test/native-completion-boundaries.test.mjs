import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyNativeCompletion } from '../src/run/native-completion.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const binding = { caseID: 'case', trialID: 'trial', turnID: 'turn', activationID: 'activation',
  incarnationID: 'incarnation', sessionID: 'root',
  scope: { complete: true, serial: true, sessionIDs: ['root', 'child'] } };
const start = (sessionID = 'root') => ({ type: 'session.execution.started', data: { sessionID } });
const delivery = (inboxID = 'prompt') => ({ type: 'session.inbox.delivered', data: { sessionID: 'root', inboxID } });
const heartbeat = () => ({ type: 'server.heartbeat', data: {} });
const failed = () => ({ id: 'native-negative', type: 'session.execution.failed',
  data: { sessionID: 'root', error: { type: 'unknown', message: 'known negative' } } });

// A finite logical adapter. End seals ingress but preserves the buffered queue.
// Hostile shutdown options deliberately break the contract to test unavailability.
function fixture({ active, events = [delivery()], onAbort, onReturn } = {}) {
  const queue = [], yielded = [], emitted = [];
  let pending, ended = false, launches = 0, activeReads = 0, returns = 0, transportSignal;
  function emit(value) {
    emitted.push(value);
    if (pending) { const resolve = pending; pending = undefined; yielded.push(value); resolve({ done: false, value }); }
    else queue.push(value);
  }
  function end() { ended = true; pending?.({ done: true }); pending = undefined; }
  const context = { emit, end };
  const stream = {
    [Symbol.asyncIterator]() { return this; },
    next() {
      if (queue.length) { const value = queue.shift(); yielded.push(value); return Promise.resolve({ done: false, value }); }
      if (ended) return Promise.resolve({ done: true });
      return new Promise((resolve) => { pending = resolve; });
    },
    return() { returns++; if (onReturn) return onReturn(context); end(); return Promise.resolve({ done: true }); },
  };
  const client = {
    event: { subscribe({ signal }) {
      transportSignal = signal;
      signal.addEventListener('abort', () => onAbort ? onAbort(context) : end(), { once: true });
      emit({ type: 'server.connected', data: {} });
      return stream;
    } },
    message: { async list() { return { data: launches ? [
      { id: 'idle', type: 'idle', outcome: 'succeeded' }, { id: 'prompt', type: 'user' },
    ] : [], cursor: { next: null } }; } },
    experimental: { session: { async wait() {} }, job: { async list() { return []; } } },
    session: { inbox: { async list() { return []; } },
      async active() { return active ? active({ n: ++activeReads, ...context }) : {}; } },
  };
  return { client, emitted, yielded, ...context,
    async launch({ binding }) { launches++; events.forEach(emit); await tick(); return { binding, raw: Buffer.from('raw\n') }; },
    get launches() { return launches; }, get returns() { return returns; },
    get signal() { return transportSignal; }, get queued() { return queue.length; },
  };
}
const run = (f, extra = {}) => verifyNativeCompletion({ ...f, binding, limits: { deadlineMs: 500, closeMs: 25 }, ...extra });

test('C1: an observed start at the active-read boundary blocks preflight for root and inventoried child', async (t) => {
  for (const sessionID of ['root', 'child']) await t.test(sessionID, async () => {
    const event = start(sessionID);
    const f = fixture({ active: async ({ n, emit }) => { if (n === 1) { emit(event); await tick(); } return {}; } });
    const result = await run(f);
    assert.ok(result.evidence.some(({ kind, value }) => kind === 'event' && value.data.sessionID === sessionID));
    assert.equal(f.launches, 0);
    assert.ok(result.health.issues.includes('execution_start_outside_window'));
    assert.equal(result.logicalProof, false);
    assert.equal(result.admission.status, 'unknown');
  });
});

test('C1 control: an in-window root start does not invent admission or conflict', async () => {
  const f = fixture({ events: [start(), delivery()] });
  const result = await run(f);
  assert.equal(f.launches, 1);
  assert.equal(result.admission.promptID, 'prompt');
  assert.equal(result.logicalProof, true);
  assert.ok(!result.health.issues.includes('execution_start_outside_window'));
});

test('C2: retain every yielded final-read frame before recomputing duplicate and negative conflicts', async (t) => {
  for (const conflict of [delivery('competing'), failed()]) await t.test(conflict.type, async () => {
    const f = fixture({ active: ({ n, emit }) => { if (n === 2) { emit(heartbeat()); emit(conflict); } return {}; } });
    const result = await run(f);
    assert.ok(f.yielded.includes(conflict), 'same-path conflict was already yielded');
    assert.equal(f.queued, 0);
    assert.deepEqual(result.evidence.filter(({ kind }) => kind === 'event').map(({ value }) => value), f.yielded);
    assert.equal(result.logicalProof, false);
    assert.equal(result.native.outcome, 'succeeded', 'stored fact remains separate from the late conflicting event');
    if (conflict.type === 'session.inbox.delivered') assert.equal(result.admission.status, 'unknown');
    else assert.ok(result.health.issues.includes('contradictory_terminal_event'));
  });
});

test('C2: the bounded close fence consumes multiple buffered frames at final read, abort, and return', async (t) => {
  for (const boundary of ['final-read', 'abort', 'return']) await t.test(boundary, async () => {
    const burst = ({ emit }) => { for (let n = 0; n < 12; n++) emit(heartbeat()); emit(failed()); emit(delivery('competing')); };
    const f = fixture({
      active: ({ n, ...context }) => { if (n === 2 && boundary === 'final-read') burst(context); return {}; },
      onAbort: boundary === 'abort' ? (context) => { burst(context); context.end(); }
        : boundary === 'return' ? () => {} : undefined,
      onReturn: boundary === 'return' ? (context) => { burst(context); context.end(); return { done: true }; } : undefined,
    });
    const result = await run(f);
    assert.equal(f.queued, 0);
    assert.deepEqual(result.evidence.filter(({ kind }) => kind === 'event').map(({ value }) => value), f.emitted);
    assert.equal(result.logicalProof, false);
    assert.equal(result.admission.status, 'unknown');
    assert.ok(result.health.issues.includes('contradictory_terminal_event'));
    assert.equal(result.health.fence, 'complete');
    assert.equal(f.returns, 1);
  });
});

test('C2 control: normal clean close and benign buffered frames do not manufacture event loss', async () => {
  const f = fixture({ active: ({ n, emit }) => { if (n === 2) for (let i = 0; i < 12; i++) emit(heartbeat()); return {}; } });
  const result = await run(f);
  assert.equal(result.logicalProof, true);
  assert.equal(result.health.close, 'closed');
  assert.equal(result.health.fence, 'complete');
  assert.deepEqual(result.health.issues, []);
  assert.deepEqual(result.evidence.filter(({ kind }) => kind === 'event').map(({ value }) => value), f.emitted);
  assert.equal(f.signal.aborted, true);
});

test('C2 control: an already-yielded matching terminal is retained without manufacturing a conflicting outcome', async () => {
  const terminal = { type: 'session.execution.succeeded', data: { sessionID: 'root' } };
  const f = fixture({ active: ({ n, emit }) => {
    if (n === 2) { for (let i = 0; i < 12; i++) emit(heartbeat()); emit(terminal); }
    return {};
  } });
  const result = await run(f);
  assert.deepEqual(result.evidence.filter(({ kind }) => kind === 'event').map(({ value }) => value), f.emitted);
  assert.equal(result.logicalProof, true);
  assert.equal(result.native.outcome, 'succeeded');
});

test('C1/C2: a start yielded during close is still an outside-window conflict', async () => {
  const f = fixture({ onAbort: ({ emit, end }) => { emit(start('child')); end(); } });
  const result = await run(f);
  assert.ok(result.health.issues.includes('execution_start_outside_window'));
  assert.equal(result.logicalProof, false);
  assert.equal(result.health.fence, 'complete');
});

test('C2: return alone cannot certify an unresolved next; deadline detaches results, not a mutating pump', async () => {
  const f = fixture({ onAbort: () => {}, onReturn: () => ({ done: true }) });
  const result = await run(f);
  assert.equal(result.logicalProof, false);
  assert.equal(result.health.close, 'closed');
  assert.equal(result.health.fence, 'unknown');
  assert.ok(result.health.issues.includes('stream_fence_deadline'));
  const snapshot = JSON.stringify(result);
  f.emit(failed()); f.end(); await tick();
  assert.equal(JSON.stringify(result), snapshot, 'late unresolved read cannot mutate the returned sidecar');
});

test('C2: event and byte bounds remain active during close; an unaccounted buffer is unavailable', async (t) => {
  for (const limit of ['events', 'bytes']) await t.test(limit, async () => {
    const f = fixture({ onAbort: (context) => {
      if (limit === 'bytes') context.emit({ type: 'server.heartbeat', data: { text: 'x'.repeat(2000) } });
      else for (let n = 0; n < 12; n++) context.emit(heartbeat());
      context.emit(failed()); context.end();
    } });
    const result = await run(f, { limits: { deadlineMs: 500, closeMs: 25,
      ...(limit === 'events' ? { maxEvents: 4 } : { maxBytes: 1500 }) } });
    assert.equal(result.logicalProof, false);
    assert.equal(result.health.fence, 'unknown');
    assert.ok(result.health.issues.includes(limit === 'events' ? 'event_limit' : 'evidence_byte_limit'));
    assert.equal(result.native.outcome, 'succeeded');
    const snapshot = JSON.stringify(result); await tick(); assert.equal(JSON.stringify(result), snapshot);
  });
});

test('Standards-C1: repeated explicit terminal ID fails, but distinct matching terminals are not replay', async () => {
  for (const repeated of [true, false]) {
    const terminal = { id: 'evt_one', type: 'session.execution.succeeded', data: { sessionID: 'root' } };
    const f = fixture({ events: [delivery(), terminal, { ...terminal, id: repeated ? 'evt_one' : 'evt_two' }] });
    const result = await run(f);
    assert.equal(result.logicalProof, !repeated);
    assert.equal(result.health.issues.includes('replayed_terminal_event'), repeated);
    assert.equal(result.evidence.filter(({ kind, value }) => kind === 'event' && value.type === terminal.type).length, 2);
  }
});

test('Standards-C2: capture raw once; size and digest use that exact subarray, not its backing buffer', async () => {
  const f = fixture();
  const original = f.launch;
  const backing = Buffer.from([9, 1, 2, 3, 9]), view = backing.subarray(1, 4);
  let reads = 0;
  f.launch = async (input) => ({ ...await original(input), get raw() { return ++reads === 1 ? view : Buffer.alloc(64); } });
  const result = await run(f, { limits: { maxRawBytes: 3 } });
  assert.equal(reads, 1);
  assert.equal(result.raw.bytes, 3);
  assert.equal(result.raw.sha256, '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
  assert.deepEqual([...backing], [9, 1, 2, 3, 9]);
  assert.equal(result.logicalProof, true);
});

test('Standards-C3: throwing diagnostic access cannot erase a stored negative or prevent iterator return', async () => {
  for (const outcome of ['failed', 'interrupted']) {
    const diagnostic = { get message() { throw Error('diagnostic accessor failed'); } };
    const f = fixture({ onReturn: () => { throw diagnostic; } });
    f.client.message.list = async () => ({ data: f.launches ? [
      { id: 'idle', type: 'idle', outcome }, { id: 'prompt', type: 'user' },
    ] : [], cursor: { next: null } });
    f.client.experimental.job.list = async () => { if (f.launches) throw diagnostic; return []; };
    const result = await run(f);
    assert.equal(result.native.outcome, outcome);
    assert.equal(result.logicalProof, false);
    assert.ok(result.health.issues.includes('unknown_error'));
    assert.ok(result.health.issues.every((item) => typeof item === 'string' && item.length <= 160));
    assert.equal(f.returns, 1);
    assert.equal(f.signal.aborted, true);
  }
});

test('Standards-C4: unsupported async subscription is refused and its late rejection stays owned', async () => {
  const f = fixture();
  let rejectSubscription;
  f.client.event.subscribe = () => new Promise((_, reject) => { rejectSubscription = reject; });
  const result = await run(f);
  assert.equal(f.launches, 0);
  assert.equal(result.logicalProof, false);
  assert.ok(result.health.issues.includes('unsupported_subscription_shape'));
  const snapshot = JSON.stringify(result);
  rejectSubscription(Error('late unsupported subscription failure')); await tick();
  assert.equal(JSON.stringify(result), snapshot);
});

test('Standards-C5: older history failure preserves only a validated contiguous prompt-bound negative', async (t) => {
  const user = (id) => ({ id, type: 'user' });
  const idle = (id, outcome) => ({ id, type: 'idle', outcome });
  const page = (data, next = 'older') => ({ data, cursor: { next } });
  for (const [name, pages, expected, baseline = []] of [
    ['failed', [page([idle('first', 'failed'), user('prompt')])], 'failed'],
    ['interrupted across pages', [page([idle('first', 'interrupted')], 'second'), page([user('prompt')])], 'interrupted'],
    ['success not promoted', [page([idle('first', 'succeeded'), user('prompt')])], undefined],
    ['first idle not later failure', [page([idle('later', 'failed'), idle('first', 'succeeded'), user('prompt')])], undefined],
    ['missing user across unseen gap', [page([idle('first', 'failed')])], undefined],
    ['invalid page is not a segment', [page([idle('first', 'failed'), user('prompt'), { type: 'user' }])], undefined],
    ['intervening user', [page([idle('first', 'failed'), user('competing'), user('prompt')])], undefined],
    ['historical idle cannot bind new prompt', [page([idle('first', 'failed'), user('prompt')])], undefined, [idle('first', 'failed')]],
  ]) await t.test(name, async () => {
    const f = fixture();
    let index = 0;
    f.client.message.list = async () => {
      if (!f.launches) return page(baseline, null);
      if (index >= pages.length) throw Error('older history unavailable');
      return pages[index++];
    };
    const result = await run(f);
    assert.equal(result.admission.status, 'unknown');
    assert.equal(result.logicalProof, false);
    assert.equal(result.native.outcome, expected);
    if (expected) {
      assert.equal(result.native.status, 'known');
      assert.equal(result.native.promptID, 'prompt');
      assert.equal(result.native.idleID, 'first');
      assert.ok(result.health.issues.includes('read_projection_unavailable'));
    }
  });
});
