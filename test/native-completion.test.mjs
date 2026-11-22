import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyNativeCompletion } from '../src/run/native-completion.mjs';

const binding = Object.freeze({ caseID: 'synthetic', trialID: 'trial-1', turnID: 'turn-1',
  activationID: 'activation-1', incarnationID: 'incarnation-1', sessionID: 'ses_owned',
  scope: { complete: true, serial: true, sessionIDs: ['ses_owned'] } });
const raw = Buffer.from('{"type":"step_finish","id":"unchanged"}\r\n');
const user = (id) => ({ id, type: 'user' });
const idle = (id, outcome = 'succeeded') => ({ id, type: 'idle', outcome });
const page = (data, next = null) => ({ data, cursor: { next } });
const connected = { type: 'server.connected', data: {} };
const delivered = (inboxID = 'msg_prompt', sessionID = 'ses_owned') =>
  ({ type: 'session.inbox.delivered', data: { sessionID, inboxID } });

// Finite, controllable public-client fake: no timer/server/network/provider.
function fixture(options = {}) {
  const calls = [], queued = [];
  let waiter, ended = false, launched = false, returned = false;
  const emit = (value) => {
    const item = { value, done: false };
    if (waiter) { const resolve = waiter; waiter = undefined; resolve(item); }
    else queued.push(item);
  };
  const end = () => { ended = true; waiter?.({ done: true }); waiter = undefined; };
  const stream = {
    [Symbol.asyncIterator]() { return this; },
    next() {
      if (queued.length) return Promise.resolve(queued.shift());
      if (ended) return Promise.resolve({ done: true });
      return new Promise((resolve) => { waiter = resolve; });
    },
    return() { returned = true; end(); return Promise.resolve({ done: true }); },
  };
  const client = {
    event: { subscribe({ signal }) {
      calls.push('subscribe'); signal.addEventListener('abort', end, { once: true });
      if (options.connect !== false) emit(connected);
      return stream;
    } },
    message: { async list(input) {
      calls.push(['messages', input]);
      const pages = launched ? (options.after ?? [page([idle('msg_idle'), user('msg_prompt'), user('msg_old')])])
        : (options.before ?? [page([user('msg_old')])]);
      return pages[input.cursor ? Number(input.cursor) : 0];
    } },
    experimental: {
      session: { async wait(input) { calls.push(['wait', input]); } },
      job: { async list(input) { calls.push(['jobs', input]); return []; } },
    },
    session: {
      inbox: { async list(input) { calls.push(['inbox', input]); return []; } },
      async active() { calls.push('active'); return {}; },
    },
  };
  async function launch(input) {
    calls.push('launch'); launched = true;
    for (const event of options.events ?? [delivered()]) emit(event);
    await options.duringLaunch?.({ emit, end, input });
    return { binding, raw };
  }
  return { client, launch, emit, end, calls, get returned() { return returned; } };
}

test('gates caller launch on actual connected event; pages baseline and exact stored prompt', async () => {
  const f = fixture({ connect: false,
    before: [page([idle('msg_old_idle')], '1'), page([user('msg_old')])],
    after: [page([idle('msg_idle')], '1'), page([user('msg_prompt'), idle('msg_old_idle')], '2'), page([user('msg_old')])],
  });
  const bytes = Buffer.from(raw);
  const running = verifyNativeCompletion({ client: f.client, binding, launch: f.launch });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(f.calls.includes('subscribe'));
  assert.ok(!f.calls.includes('launch'), 'an iterable alone is not readiness');
  f.emit(connected);
  const result = await running;
  assert.equal(result.phase, 'PROVISIONAL');
  assert.equal(result.admission.status, 'known');
  assert.equal(result.admission.promptID, 'msg_prompt');
  assert.deepEqual(result.native, { status: 'known', promptID: 'msg_prompt', idleID: 'msg_idle', outcome: 'succeeded' });
  assert.equal(result.quiescence.status, 'empty');
  assert.equal(result.logicalProof, true);
  assert.equal(result.wire.status, 'unqualified');
  assert.equal(result.accepted, false);
  assert.deepEqual(raw, bytes);
  assert.equal(result.raw.bytes, raw.length);
  assert.equal(result.raw.sha256, '9373fb708cb8dc8cedee43e5b5cfb1667dcb1738e130f0c803af05b16ff0f8ef');
  assert.equal(f.returned, true);
  assert.deepEqual(f.calls.filter((x) => Array.isArray(x) && x[0] === 'jobs')[0][1],
    { sessionID: 'ses_owned', descendants: true });
  assert.equal('observer' in result, false);
  assert.equal('cleanup' in result, false);
  assert.equal('costComplete' in result, false);
});

test('admission is unavailable for competing, foreign, unknown or baseline deliveries', async (t) => {
  for (const [name, events] of [
    ['two IDs', [delivered(), delivered('msg_other')]],
    ['duplicate delivery', [delivered(), delivered()]],
    ['foreign session', [delivered('msg_prompt', 'ses_foreign')]],
    ['unknown ID', [{ type: 'session.inbox.delivered', data: { sessionID: 'ses_owned' } }]],
    ['old ID', [delivered('msg_old')]],
    ['missing delivery', []],
  ]) await t.test(name, async () => {
    const f = fixture({ events });
    const result = await verifyNativeCompletion({ ...f, binding });
    assert.equal(result.admission.status, 'unknown');
    assert.equal(result.logicalProof, false);
  });
});

test('a delivery during final status reads invalidates an earlier apparent admission', async () => {
  const f = fixture();
  let reads = 0;
  f.client.session.active = async () => {
    if (++reads === 2) f.emit(delivered('msg_competing'));
    return {};
  };
  const result = await verifyNativeCompletion({ ...f, binding });
  assert.equal(result.admission.status, 'unknown');
  assert.equal(result.logicalProof, false);
});

test('projection requires the exact new user ID, never equal text or newest message', async (t) => {
  for (const [name, after] of [
    ['missing prompt', [idle('msg_idle'), user('msg_other'), user('msg_old')]],
    ['prompt is assistant', [idle('msg_idle'), { id: 'msg_prompt', type: 'assistant' }, user('msg_old')]],
    ['second user without event', [idle('msg_idle'), user('msg_other'), user('msg_prompt'), user('msg_old')]],
    ['baseline disappeared', [idle('msg_idle'), user('msg_prompt')]],
  ]) await t.test(name, async () => {
    const f = fixture({ after: [page(after)] });
    const result = await verifyNativeCompletion({ ...f, binding });
    assert.equal(result.admission.status, 'unknown');
    assert.equal(result.logicalProof, false);
  });
});

test('native wait failure cannot erase a separately readable stored failed outcome', async () => {
  const f = fixture({ after: [page([idle('msg_idle', 'failed'), user('msg_prompt'), user('msg_old')])] });
  f.client.experimental.session.wait = async () => { throw new Error('unsupported endpoint'); };
  const result = await verifyNativeCompletion({ ...f, binding });
  assert.equal(result.native.outcome, 'failed');
  assert.equal(result.health.transport, 'unavailable');
  assert.equal(result.logicalProof, false);
});

test('first following idle is authoritative; known failed/interrupted survive status failure', async (t) => {
  for (const outcome of ['succeeded', 'failed', 'interrupted']) await t.test(outcome, async () => {
    const first = { ...idle('msg_first', outcome), ...(outcome === 'failed' ? { error: { type: 'unknown', message: 'synthetic failure' } } : {}) };
    const f = fixture({ after: [page([idle('msg_later', 'succeeded'), first, user('msg_prompt'), user('msg_old')])] });
    let reads = 0;
    f.client.experimental.job.list = async () => {
      if (++reads === 2) throw new Error('read unavailable');
      return [];
    };
    const result = await verifyNativeCompletion({ ...f, binding });
    assert.equal(result.native.idleID, 'msg_first');
    assert.equal(result.native.outcome, outcome);
    if (outcome === 'failed') assert.deepEqual(result.native.error, first.error);
    assert.equal(result.quiescence.status, 'unknown');
    assert.equal(result.logicalProof, false);
  });
});

test('exit zero, step_finish, stop, successful wait and empty status do not replace a stored idle', async () => {
  const f = fixture({ after: [page([{ id: 'msg_assistant', type: 'assistant', finish: 'stop' }, user('msg_prompt'), user('msg_old')])],
    events: [delivered(), { type: 'session.step.ended', data: { sessionID: 'ses_owned', finish: 'stop' } }] });
  const result = await verifyNativeCompletion({ ...f, binding });
  assert.equal(result.native.status, 'unknown');
  assert.equal(result.quiescence.status, 'empty');
  assert.equal(result.logicalProof, false);
});

test('event loss retains a known native negative but never certifies success', async (t) => {
  for (const outcome of ['succeeded', 'failed', 'interrupted']) await t.test(outcome, async () => {
    const f = fixture({ after: [page([idle('msg_idle', outcome), user('msg_prompt'), user('msg_old')])],
      duringLaunch: async ({ end }) => { await new Promise((resolve) => setImmediate(resolve)); end(); } });
    const result = await verifyNativeCompletion({ ...f, binding });
    assert.equal(result.native.outcome, outcome);
    assert.equal(result.health.stream, 'unavailable');
    assert.equal(result.logicalProof, false);
  });
});

test('preflight and final reads fail closed for missing, malformed and nonempty owned/foreign status', async (t) => {
  for (const stage of ['preflight', 'final']) {
    for (const endpoint of ['jobs', 'inbox', 'active']) {
      for (const mode of ['missing', 'malformed', 'owned', 'foreign']) await t.test(`${stage}/${endpoint}/${mode}`, async () => {
        const f = fixture();
        const holder = endpoint === 'jobs' ? f.client.experimental.job : endpoint === 'inbox' ? f.client.session.inbox : f.client.session;
        const key = endpoint === 'active' ? 'active' : 'list';
        const original = holder[key];
        let calls = 0;
        holder[key] = async (...args) => {
          if (++calls !== (stage === 'preflight' ? 1 : 2)) return original(...args);
          if (mode === 'missing') throw new Error('endpoint unavailable');
          if (mode === 'malformed') return null;
          const sessionID = mode === 'owned' ? 'ses_owned' : 'ses_foreign';
          return endpoint === 'active' ? { [sessionID]: {} } : [{ id: 'synthetic_work', sessionID }];
        };
        const result = await verifyNativeCompletion({ ...f, binding });
        assert.equal(result.logicalProof, false);
        if (stage === 'preflight') assert.ok(!f.calls.includes('launch'));
        else assert.equal(result.native.outcome, 'succeeded');
        if (mode === 'missing') assert.equal(result.health.transport, 'unavailable');
      });
    }
  }
});

test('complete trusted descendant inventory is checked in job → all inboxes → active order', async () => {
  const owned = { ...binding, scope: { ...binding.scope, sessionIDs: ['ses_owned', 'ses_child'] } };
  const f = fixture();
  const result = await verifyNativeCompletion({ client: f.client, binding: owned,
    launch: async (input) => ({ ...await f.launch(input), binding: owned }) });
  assert.equal(result.logicalProof, true);
  const sequence = f.calls.filter((call) => call === 'active' || ['jobs', 'inbox'].includes(call[0]));
  assert.deepEqual(sequence, [
    ['jobs', { sessionID: 'ses_owned', descendants: true }],
    ['inbox', { sessionID: 'ses_owned' }], ['inbox', { sessionID: 'ses_child' }], 'active',
    ['jobs', { sessionID: 'ses_owned', descendants: true }],
    ['inbox', { sessionID: 'ses_owned' }], ['inbox', { sessionID: 'ses_child' }], 'active',
  ]);
});

test('all asynchronous boundaries have a deadline; abort reaches the client and caller', async (t) => {
  for (const boundary of ['baseline', 'connected', 'launch', 'wait', 'projection', 'quiescence']) await t.test(boundary, async () => {
    const f = fixture({ connect: boundary !== 'connected' });
    let observedSignal;
    const hanging = (_input, options) => { observedSignal = options?.signal; return new Promise(() => {}); };
    let launch = f.launch;
    if (boundary === 'baseline') f.client.message.list = hanging;
    if (boundary === 'launch') launch = (input) => { observedSignal = input.signal; return new Promise(() => {}); };
    if (boundary === 'wait') f.client.experimental.session.wait = hanging;
    if (boundary === 'projection') {
      const original = f.client.message.list;
      let n = 0;
      f.client.message.list = (...args) => ++n === 2 ? hanging(...args) : original(...args);
    }
    if (boundary === 'quiescence') {
      let n = 0;
      f.client.experimental.job.list = (...args) => ++n === 2 ? hanging(...args) : [];
    }
    const result = await verifyNativeCompletion({ client: f.client, binding, launch, limits: { deadlineMs: 15, closeMs: 15 } });
    assert.ok(result.health.issues.includes('deadline'));
    assert.equal(result.logicalProof, false);
    if (observedSignal) assert.equal(observedSignal.aborted, true);
  });
});

test('caller cancellation while awaiting connected never launches; already aborted does no reads', async () => {
  for (const already of [false, true]) {
    const controller = new AbortController();
    const f = fixture({ connect: false });
    if (already) controller.abort();
    const running = verifyNativeCompletion({ ...f, binding, signal: controller.signal });
    if (!already) { await new Promise((resolve) => setImmediate(resolve)); controller.abort(); }
    const result = await running;
    assert.ok(result.health.issues.includes('cancelled'));
    assert.ok(!f.calls.includes('launch'));
    if (already) assert.equal(f.calls.length, 0);
  }
});

test('bounds pages, repeated cursors, duplicate IDs, events and evidence bytes before launch', async (t) => {
  for (const [name, options, limits] of [
    ['pages', { before: [page([user('msg_a')], '1'), page([user('msg_b')])] }, { maxPages: 1 }],
    ['cursor cycle', { before: [page([user('msg_a')], '1'), page([user('msg_b')], '1')] }, {}],
    ['duplicate ID', { before: [page([user('msg_a'), user('msg_a')])] }, {}],
    ['bytes', { before: [page([{ ...user('msg_a'), text: 'x'.repeat(500) }])] }, { maxBytes: 100 }],
  ]) await t.test(name, async () => {
    const f = fixture(options);
    const result = await verifyNativeCompletion({ ...f, binding, limits });
    assert.equal(result.logicalProof, false);
    assert.ok(!f.calls.includes('launch'));
  });
  const f = fixture({ events: [delivered(), { type: 'permission.asked', data: {} }] });
  const result = await verifyNativeCompletion({ ...f, binding, limits: { maxEvents: 2 } });
  assert.ok(result.health.issues.includes('event_limit'));
  assert.equal(result.logicalProof, false);
});

test('binding disagreement and raw overflow cannot be turned into a completion receipt', async (t) => {
  for (const key of ['caseID', 'trialID', 'turnID', 'activationID', 'incarnationID', 'sessionID']) await t.test(key, async () => {
    const f = fixture();
    const result = await verifyNativeCompletion({ client: f.client, binding,
      launch: async (input) => ({ ...await f.launch(input), binding: { ...binding, [key]: 'foreign' } }) });
    assert.ok(result.health.issues.includes('launch_binding_disagreement'));
    assert.equal(result.logicalProof, false);
  });
  const f = fixture();
  const result = await verifyNativeCompletion({ ...f, binding, limits: { maxRawBytes: 1 } });
  assert.equal(result.raw.status, 'unknown');
  assert.equal(result.logicalProof, false);
});

test('a baseline idle moved above the new prompt cannot become this turn’s outcome', async () => {
  const f = fixture({ before: [page([idle('msg_old_idle'), user('msg_old')])],
    after: [page([idle('msg_old_idle'), user('msg_prompt'), user('msg_old')])] });
  const result = await verifyNativeCompletion({ ...f, binding });
  assert.equal(result.native.status, 'unknown');
  assert.equal(result.admission.status, 'unknown');
  assert.equal(result.logicalProof, false);
});

test('late contradictory terminal events are recorded independently of stored success', async () => {
  const f = fixture();
  let reads = 0;
  f.client.session.active = async () => {
    if (++reads === 2) f.emit({ id: 'evt_native', type: 'session.execution.failed', data: { sessionID: 'ses_owned', error: { type: 'unknown', message: 'synthetic' } } });
    return {};
  };
  const result = await verifyNativeCompletion({ ...f, binding });
  assert.equal(result.native.outcome, 'succeeded');
  assert.ok(result.health.issues.includes('contradictory_terminal_event'));
  assert.equal(result.logicalProof, false);
});

test('no writes, prompts, permission replies or raw normalization; binary bytes remain untouched', async () => {
  const f = fixture({ events: [delivered(), { type: 'permission.asked', data: { sessionID: 'ses_owned' } }] });
  const forbidden = () => assert.fail('native write API was accessed');
  for (const name of ['prompt', 'interrupt', 'switchAgent', 'switchModel']) Object.defineProperty(f.client.session, name, { get: forbidden });
  Object.defineProperty(f.client, 'permission', { get: forbidden });
  Object.defineProperty(f.client.session.inbox, 'cancel', { get: forbidden });
  const bytes = Buffer.from([0, 255, 13, 10, 123, 10]);
  const result = await verifyNativeCompletion({ client: f.client, binding,
    launch: async (input) => ({ ...await f.launch(input), raw: bytes }) });
  assert.deepEqual([...bytes], [0, 255, 13, 10, 123, 10]);
  assert.equal(result.raw.bytes, 6);
  assert.equal(result.logicalProof, true);
});

test('preflight is observed on the connected stream, not an obsolete pre-subscription snapshot', async () => {
  const f = fixture({ connect: false });
  const running = verifyNativeCompletion({ ...f, binding });
  await new Promise((resolve) => setImmediate(resolve));
  f.client.experimental.job.list = async () => [{ id: 'job_unexpected', sessionID: 'ses_owned' }];
  f.emit(connected);
  const result = await running;
  assert.ok(!f.calls.includes('launch'));
  assert.equal(result.preflight.status, 'nonempty');
});

test('delivery or stream loss during preflight blocks caller launch', async (t) => {
  for (const mode of ['delivery', 'loss']) await t.test(mode, async () => {
    const f = fixture();
    f.client.session.active = async () => {
      if (mode === 'delivery') f.emit(delivered());
      else f.end();
      return {};
    };
    const result = await verifyNativeCompletion({ ...f, binding });
    assert.ok(!f.calls.includes('launch'));
    assert.equal(result.logicalProof, false);
  });
});

test('stream return is bounded and close failure cannot certify success', async () => {
  const f = fixture();
  const subscribe = f.client.event.subscribe;
  f.client.event.subscribe = (...args) => {
    const stream = subscribe(...args);
    stream.return = () => new Promise(() => {});
    return stream;
  };
  const result = await verifyNativeCompletion({ ...f, binding, limits: { closeMs: 10 } });
  assert.equal(result.native.outcome, 'succeeded');
  assert.equal(result.health.close, 'unknown');
  assert.ok(result.health.issues.includes('stream_close_deadline'));
  assert.equal(result.logicalProof, false);
});

test('raw capture failure is separate from a known native failure and empty quiescence', async () => {
  const f = fixture({ after: [page([idle('msg_idle', 'failed'), user('msg_prompt'), user('msg_old')])] });
  const result = await verifyNativeCompletion({ ...f, binding, limits: { maxRawBytes: 1 } });
  assert.equal(result.raw.status, 'unknown');
  assert.equal(result.native.outcome, 'failed');
  assert.equal(result.quiescence.status, 'empty');
  assert.equal(result.logicalProof, false);
});

test('a later failed idle cannot replace this prompt’s first succeeded idle', async () => {
  const f = fixture({ after: [page([idle('msg_later', 'failed'), idle('msg_first'), user('msg_prompt'), user('msg_old')])] });
  const result = await verifyNativeCompletion({ ...f, binding });
  assert.equal(result.native.idleID, 'msg_first');
  assert.equal(result.native.outcome, 'succeeded');
});

test('reconnect, malformed idle and unscoped execution event cannot certify completion', async (t) => {
  for (const kind of ['reconnect', 'idle', 'unscoped']) await t.test(kind, async () => {
    const f = fixture({
      events: [delivered(), ...(kind === 'reconnect' ? [connected] : kind === 'unscoped' ? [{ type: 'session.execution.started', data: {} }] : [])],
      after: [page([idle('msg_idle', kind === 'idle' ? 'stop' : 'succeeded'), user('msg_prompt'), user('msg_old')])],
    });
    const result = await verifyNativeCompletion({ ...f, binding });
    assert.equal(result.logicalProof, false);
  });
});

test('scope and limits must be explicit, finite, bounded runner assertions', async () => {
  for (const change of [
    { limits: { deadlineMs: Infinity } }, { limits: { maxPages: 0 } }, { limits: { extra: 1 } },
    { binding: { ...binding, scope: { ...binding.scope, complete: false } } },
    { binding: { ...binding, scope: { ...binding.scope, sessionIDs: ['ses_other'] } } },
  ]) {
    const f = fixture();
    await assert.rejects(verifyNativeCompletion({ ...f, binding, ...change }), /invalid_/);
    assert.equal(f.calls.length, 0);
  }
});

test('private sidecar does not copy unbounded runner metadata or thrown transport errors', async () => {
  const f = fixture();
  f.client.experimental.job.list = async () => { throw new Error('x'.repeat(10_000)); };
  const result = await verifyNativeCompletion({ ...f, binding: { ...binding, unrelated: 'x'.repeat(10_000) } });
  assert.equal('unrelated' in result.binding, false);
  assert.ok(result.health.issues.every((issue) => issue.length <= 160));
  assert.equal(result.health.transport, 'unavailable');
});

test('receipt identity is structural, independent of object property insertion order', async () => {
  const f = fixture();
  const result = await verifyNativeCompletion({ ...f, binding, launch: async (input) => ({
    ...await f.launch(input), binding: { ...binding, scope: { sessionIDs: ['ses_owned'], serial: true, complete: true } },
  }) });
  assert.equal(result.logicalProof, true);
});
