import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyNativeCompletion } from '../src/run/native-completion.mjs';

// Source-shaped, not native captures. Pin and classification: docs/native-completion-transcript.md.
const binding = { caseID: 'synthetic', trialID: 'trial', turnID: 'turn', activationID: 'activation',
  incarnationID: 'incarnation', sessionID: 'ses_owned',
  scope: { complete: true, serial: true, sessionIDs: ['ses_owned'] } };
const model = { id: 'model', providerID: 'provider', variant: 'default' };
const record = (id, type, fields = {}) => ({ id, type, time: { created: 1 }, ...fields });
const user = (id = 'msg_prompt') => record(id, 'user', { text: 'exact synthetic input' });
const idle = (id = 'msg_idle', outcome = 'succeeded') => record(id, 'idle', { outcome });
const agent = (id = 'msg_agent') => record(id, 'agent-switched', { agent: 'build', previous: 'plan' });
const selected = (id = 'msg_model') => record(id, 'model-switched', { model, previous: { id: 'old', providerID: 'provider' } });
const system = (id = 'msg_system') => record(id, 'system', { text: 'instructions updated', description: 'notice',
  metadata: { notice: 'instructions', instructionSources: ['synthetic'] } });
const synthetic = (id = 'msg_synthetic') => record(id, 'synthetic', { text: 'another input', description: 'synthetic input' });
const skill = (id = 'msg_skill') => record(id, 'skill', { skill: 'skill_synthetic', name: 'synthetic', text: 'skill text' });
const shell = (id = 'msg_shell', status = 'exited') => record(id, 'shell', { shellID: 'sh_synthetic', command: 'synthetic command',
  status, exit: 0, output: { output: 'synthetic output', cursor: 1, size: 1, truncated: false }, time: { created: 1, completed: 2 } });
const location = (id = 'msg_location') => record(id, 'location-switched', { location: { directory: '/synthetic', workspaceID: 'ws_synthetic' },
  projectID: 'prj_synthetic', subpath: 'synthetic', previous: { location: { directory: '/previous' }, subpath: '' } });
const compaction = (id = 'msg_compaction', status = 'completed') => record(id, 'compaction', { status, reason: 'auto',
  ...(status === 'failed' ? { error: { type: 'unknown', message: 'synthetic failure' } } : { summary: 'synthetic summary' }),
  ...(status === 'completed' ? { model, native: { messages: [{ role: 'assistant', content: 'replacement window' }] }, metadata: { keepID: 'msg_old' } } : {}) });
const assistant = (id = 'msg_assistant') => record(id, 'assistant', { agent: 'build', model,
  content: [{ type: 'text', text: 'synthetic answer', native: { provider: 'opaque' } }], time: { created: 1, completed: 2 } });
const page = (data, next) => ({ data, cursor: next === undefined ? {} : { next } });
const delivery = (inboxID = 'msg_prompt') => ({ id: 'evt_delivery', type: 'session.inbox.delivered',
  data: { sessionID: 'ses_owned', inboxID } });
const raw = Buffer.from([0, 255, 13, 10, 123, 10]);

// The only external seam is the existing six-read logical client plus launch.
// No filesystem, timers, listener, runtime, network, auth, or provider in this fixture.
function fixture({ before = [], after = [idle(), user(), ...before], beforePages, afterPages,
  events = [delivery()] } = {}) {
  const calls = [], queue = [{ type: 'server.connected', data: {} }];
  let launched = false, pending, sealed = false, returns = 0, transportSignal;
  const emit = (value) => {
    if (pending) { const resolve = pending; pending = undefined; resolve({ done: false, value }); }
    else queue.push(value);
  };
  const end = () => { sealed = true; pending?.({ done: true }); pending = undefined; };
  const stream = {
    [Symbol.asyncIterator]() { return this; },
    next() {
      if (queue.length) return Promise.resolve({ done: false, value: queue.shift() });
      if (sealed) return Promise.resolve({ done: true });
      return new Promise((resolve) => { pending = resolve; });
    },
    return() { returns++; end(); return Promise.resolve({ done: true }); },
  };
  const client = {
    event: { subscribe({ signal, maxBytes }) {
      calls.push(['subscribe', maxBytes]); transportSignal = signal;
      signal.addEventListener('abort', end, { once: true }); return stream;
    } },
    message: { async list(input, options) {
      calls.push([launched ? 'projection' : 'baseline', input, options.maxBytes]);
      assert.equal(options.signal, transportSignal);
      const pages = launched ? afterPages ?? [page(after)] : beforePages ?? [page(before)];
      const index = input.cursor === undefined ? 0 : Number(input.cursor.slice(5));
      const value = pages[index];
      if (value instanceof Error) throw value;
      assert.ok(value, 'unexpected history read');
      return value;
    } },
    experimental: { session: { async wait() { calls.push(['wait']); } },
      job: { async list() { calls.push(['jobs']); return []; } } },
    session: { inbox: { async list() { calls.push(['inbox']); return []; } },
      async active() { calls.push(['active']); return {}; } },
  };
  return { client, calls,
    async launch({ binding: bound, signal }) {
      assert.equal(signal, transportSignal); calls.push(['launch']); launched = true; events.forEach(emit);
      await Promise.resolve(); return { binding: bound, raw };
    },
    get returns() { return returns; }, get sealed() { return sealed; },
  };
}
async function run(f, limits) {
  const result = await verifyNativeCompletion({ client: f.client, launch: f.launch, binding,
    limits: { deadlineMs: 1000, closeMs: 25, ...limits } });
  assert.equal(result.accepted, false);
  assert.equal(result.phase, 'PROVISIONAL');
  assert.equal(result.wire.status, 'unqualified');
  assert.equal(f.returns, 1); assert.equal(f.sealed, true);
  assert.ok(f.calls.every(([operation]) => ['subscribe', 'baseline', 'launch', 'wait', 'projection', 'jobs', 'inbox', 'active'].includes(operation)));
  return result;
}

test('native CLI agent/model switches before the exact delivered user are retained, not mistaken for input', async () => {
  const before = [user('msg_old')];
  const after = [idle(), user(), selected(), agent(), ...before];
  const f = fixture({ before, after });
  const result = await run(f);
  assert.equal(result.logicalProof, true);
  assert.deepEqual(result.admission, { status: 'known', promptID: 'msg_prompt' });
  assert.deepEqual(result.native, { status: 'known', promptID: 'msg_prompt', idleID: 'msg_idle', outcome: 'succeeded' });
  assert.deepEqual(result.evidence.find(({ kind }) => kind === 'projection').value, page(after));
  assert.deepEqual(result.baseline.messageIDs, ['msg_old']);
  assert.deepEqual([...raw], [0, 255, 13, 10, 123, 10]);
});

test('non-outcome annotations preserve exact order before prompt, within turn, and across a history page edge', async (t) => {
  for (const make of [agent, selected, system]) {
    for (const position of ['before-prompt', 'between', 'page-edge']) await t.test(`${make().type}/${position}`, async () => {
      const notice = make(), before = [user('msg_old')];
      const after = position === 'before-prompt' ? [idle(), user(), notice, ...before]
        : [idle(), notice, user(), ...before];
      const afterPages = position === 'page-edge'
        ? [page([idle(), notice], 'page_1'), page([user(), ...before], 'page_2'), page([])]
        : [page(after)];
      const f = fixture({ before, afterPages });
      const result = await run(f);
      assert.equal(result.logicalProof, true);
      assert.equal(result.native.idleID, 'msg_idle');
      assert.deepEqual(result.evidence.filter(({ kind }) => kind === 'projection').flatMap(({ value }) => value.data), after);
      assert.deepEqual(result.evidence.filter(({ kind }) => kind === 'projection').map(({ value }) => value), afterPages);
    });
  }
});

test('annotations alone cannot close a turn or turn a terminal shutdown into a stored idle', async () => {
  const terminal = { id: 'evt_shutdown', type: 'session.execution.interrupted', data: { sessionID: 'ses_owned', reason: 'shutdown' } };
  const f = fixture({ after: [system(), selected(), agent(), user()], events: [delivery(), terminal] });
  const result = await run(f);
  assert.equal(result.admission.status, 'known');
  assert.equal(result.native.status, 'unknown');
  assert.equal(result.logicalProof, false);
  assert.ok(result.health.issues.includes('native_idle_missing_or_invalid'));
  assert.deepEqual(result.evidence.filter(({ kind }) => kind === 'event').at(-1).value, terminal);
});

test('settled baseline retains every source union variant and its original fields across native empty-sentinel pagination', async () => {
  const before = [idle('msg_old_idle'), assistant('msg_old_assistant'), compaction('msg_old_compaction'),
    compaction('msg_failed_compaction', 'failed'), shell('msg_old_shell'), shell('msg_timeout_shell', 'timeout'),
    shell('msg_killed_shell', 'killed'), skill('msg_old_skill'), system('msg_old_system'), synthetic('msg_old_synthetic'),
    location('msg_old_location'), selected('msg_old_model'), agent('msg_old_agent'), user('msg_old')];
  const beforePages = [page(before.slice(0, 7), 'page_1'), page(before.slice(7), 'page_2'), page([])];
  const afterPages = [page([idle(), system(), assistant(), user(), selected(), agent(), ...before.slice(0, 7)], 'page_1'),
    page(before.slice(7), 'page_2'), page([])];
  const original = JSON.stringify({ beforePages, afterPages });
  const f = fixture({ beforePages, afterPages });
  const result = await run(f);
  assert.equal(result.logicalProof, true);
  assert.deepEqual(result.baseline.messageIDs, before.map(({ id }) => id));
  assert.deepEqual(result.evidence.filter(({ kind }) => kind === 'baseline').map(({ value }) => value), beforePages);
  assert.deepEqual(result.evidence.filter(({ kind }) => kind === 'projection').map(({ value }) => value), afterPages);
  assert.equal(JSON.stringify({ beforePages, afterPages }), original, 'consumer never relabels, sorts, filters, or mutates records');
  assert.equal(f.calls.filter(([operation]) => operation === 'baseline').length, 3);
});

test('new native input/work/move is a conflict anywhere in the new segment, not an annotation or exact prompt', async (t) => {
  for (const message of [synthetic(), skill(), location(), shell(), shell('msg_running_shell', 'running'),
    compaction(), compaction('msg_running_compaction', 'running'), compaction('msg_failed_compaction', 'failed'), user('msg_extra')]) {
    for (const position of ['before-prompt', 'between', 'after-idle']) await t.test(`${message.type}/${message.status ?? ''}/${position}`, async () => {
      const after = position === 'before-prompt' ? [idle(), user(), message]
        : position === 'between' ? [idle(), message, user()] : [message, idle(), user()];
      const result = await run(fixture({ after }));
      assert.equal(result.admission.status, 'unknown');
      assert.equal(result.native.status, 'unknown');
      assert.equal(result.logicalProof, false);
      assert.deepEqual(result.evidence.find(({ kind }) => kind === 'projection').value.data, after);
    });
  }
  for (const message of [synthetic('msg_prompt'), skill('msg_prompt'), system('msg_prompt')]) {
    const result = await run(fixture({ after: [idle(), message] }));
    assert.equal(result.admission.status, 'unknown'); assert.equal(result.native.status, 'unknown');
  }
});

test('running historical shell/compaction blocks preflight even if endpoint snapshots appear empty', async () => {
  for (const message of [shell('msg_old', 'running'), compaction('msg_old', 'running')]) {
    const f = fixture({ before: [message] });
    const result = await run(f);
    assert.equal(f.calls.some(([operation]) => operation === 'launch'), false);
    assert.equal(result.logicalProof, false);
    assert.ok(result.health.issues.includes('baseline_unsettled_work'));
  }
});

test('unknown discriminants and malformed required native fields fail closed, including in the baseline', async (t) => {
  const malformed = [
    record('msg_unknown', 'future-native-type'),
    { ...agent(), agent: undefined }, { ...agent(), previous: 5 }, { ...agent(), time: { created: '1' } },
    { ...selected(), model: { id: 'model' } }, { ...selected(), previous: { id: 'old', providerID: null } },
    { ...selected(), model: { ...model, variant: 2 } }, { ...selected(), metadata: [] },
    { ...system(), text: undefined }, { ...system(), description: {} }, { ...synthetic(), text: [] },
    { ...skill(), name: undefined }, { ...skill(), skill: 'x'.repeat(513) },
    { ...shell(), shellID: undefined }, { ...shell(), command: 1 }, { ...shell(), status: 'completed' },
    { ...shell(), output: { output: '', cursor: 0, size: 0, truncated: 0 } }, { ...shell(), exit: 'NaN' },
    { ...location(), location: {} }, { ...location(), previous: { location: 1 } },
    { ...compaction(), status: 'unknown' }, { ...compaction(), summary: undefined },
    { ...compaction(), reason: 'other' }, { ...compaction('msg_failed', 'failed'), error: {} },
    { ...idle(), outcome: 'stop' },
  ];
  for (const [index, bad] of malformed.entries()) {
    for (const position of ['baseline', 'projection']) await t.test(`${index}/${bad.type}/${position}`, async () => {
      const f = fixture(position === 'baseline' ? { before: [bad] } : { after: [idle('msg_valid_idle'), bad, user()] });
      const result = await run(f);
      assert.equal(result.logicalProof, false);
      assert.equal(result.native.status, 'unknown');
      if (position === 'baseline') assert.equal(f.calls.some(([operation]) => operation === 'launch'), false);
      assert.ok(result.health.issues.includes('invalid_message_identity'));
    });
  }
});

test('a baseline may not shrink, reorder, replace a compaction window, or change fields under an unchanged ID/type', async (t) => {
  const before = [compaction('msg_old_compaction'), system('msg_old_system'), user('msg_old')];
  for (const [name, suffix] of [
    ['shortened', before.slice(1)], ['reordered', [before[1], before[0], before[2]]],
    ['replacement window', [{ ...before[0], native: { messages: [] } }, ...before.slice(1)]],
    ['notice rewritten', [before[0], { ...before[1], text: 'replaced' }, before[2]]],
  ]) await t.test(name, async () => {
    const result = await run(fixture({ before, after: [idle(), system(), user(), agent(), ...suffix] }));
    assert.equal(result.logicalProof, false); assert.equal(result.admission.status, 'unknown');
    assert.ok(result.health.issues.includes('baseline_changed'));
  });
});

test('a conflict found on an older complete page revokes partial association, not merely final acceptance', async () => {
  for (const message of [synthetic(), compaction(), skill(), shell(), location(), user('msg_extra')]) {
    const afterPages = [page([idle('msg_failed', 'failed'), user()], 'page_1'), page([message], 'page_2'),
      new Error('older history unavailable')];
    const result = await run(fixture({ afterPages }));
    assert.equal(result.native.status, 'unknown');
    assert.equal(result.admission.status, 'unknown'); assert.equal(result.logicalProof, false);
  }
});

test('annotations never join a first idle to a user across an empty-page gap', async () => {
  const afterPages = [page([idle('msg_failed', 'failed'), system()], 'page_1'), page([], 'page_2'),
    page([user(), selected(), agent()])];
  const result = await run(fixture({ afterPages }));
  assert.equal(result.native.status, 'unknown');
  assert.equal(result.admission.status, 'unknown'); assert.equal(result.logicalProof, false);
  assert.ok(result.health.issues.includes('invalid_message_page'));
});

test('a full 200-record page does not stop pagination or sort annotation IDs/timestamps', async () => {
  const notices = Array.from({ length: 199 }, (_, n) => ({ ...agent(`msg_${199 - n}`), time: { created: n % 2 } }));
  const before = [system('msg_old_system'), user('msg_old')];
  const afterPages = [page([idle(), ...notices], 'page_1'), page([user(), selected(), ...before], 'page_2'), page([])];
  const f = fixture({ before, afterPages });
  const result = await run(f);
  assert.equal(result.logicalProof, true);
  assert.equal(result.native.idleID, 'msg_idle');
  assert.deepEqual(result.evidence.filter(({ kind }) => kind === 'projection').map(({ value }) => value), afterPages);
  assert.deepEqual(f.calls.filter(([operation]) => operation === 'projection').map(([, input]) => input), [
    { sessionID: 'ses_owned', limit: 200, order: 'desc' },
    { sessionID: 'ses_owned', limit: 200, cursor: 'page_1' },
    { sessionID: 'ses_owned', limit: 200, cursor: 'page_2' },
  ]);
});

test('older-page failure retains only a contiguous exact-user first-idle negative through annotations', async (t) => {
  for (const make of [agent, selected, system]) {
    for (const outcome of ['succeeded', 'failed', 'interrupted']) await t.test(`${make().type}/${outcome}`, async () => {
      const afterPages = [page([idle('msg_later', 'failed'), make('msg_between_idles'), idle('msg_first', outcome)], 'page_1'),
        page([make('msg_between'), user(), make('msg_before')], 'page_2'), new Error('older history unavailable')];
      const result = await run(fixture({ afterPages }));
      assert.equal(result.admission.status, 'unknown'); assert.equal(result.logicalProof, false);
      assert.equal(result.native.outcome, outcome === 'succeeded' ? undefined : outcome);
      if (outcome !== 'succeeded') {
        assert.equal(result.native.idleID, 'msg_first'); assert.equal(result.native.promptID, 'msg_prompt');
      }
      assert.ok(result.health.issues.includes('read_projection_unavailable'));
    });
  }
});

test('missing anchor, historical negative, invalid page, repeated IDs/cursors and competing input never create a partial join', async (t) => {
  for (const [name, before, afterPages] of [
    ['missing anchor', [user('msg_old')], [page([idle('msg_first', 'failed'), system()], 'page_1'), page([])]],
    ['historical idle', [idle('msg_first', 'failed')], [page([idle('msg_first', 'failed'), system(), user()], 'page_1'), new Error('older unavailable')]],
    ['missing user', [], [page([idle('msg_first', 'failed'), system()], 'page_1'), new Error('older unavailable')]],
    ['unvalidated page', [], [page([idle('msg_first', 'failed'), user(), { ...agent(), agent: undefined }], 'page_1')]],
    ['repeated ID', [], [page([idle('msg_first', 'failed'), agent()], 'page_1'), page([agent(), user()], 'page_2')]],
    ['repeated cursor', [], [page([idle('msg_first', 'failed'), agent()], 'page_1'), page([system()], 'page_1')]],
    ['intervening user', [], [page([idle('msg_first', 'failed'), system(), user('msg_other')], 'page_1'), page([user()], 'page_2')]],
    ['invalid first idle', [], [page([idle('msg_later', 'failed'), idle('msg_first', 'invalid'), system(), user()])]],
  ]) await t.test(name, async () => {
    const result = await run(fixture({ before, afterPages }));
    assert.equal(result.native.status, 'unknown');
    assert.equal(result.admission.status, 'unknown'); assert.equal(result.logicalProof, false);
  });
});

test('annotations never change first-idle precedence in a complete projection', async () => {
  for (const outcome of ['succeeded', 'failed', 'interrupted']) {
    const after = [idle('msg_later', outcome === 'succeeded' ? 'failed' : 'succeeded'), system(),
      idle('msg_first', outcome), selected(), agent(), user()];
    const result = await run(fixture({ after }));
    assert.equal(result.native.idleID, 'msg_first'); assert.equal(result.native.outcome, outcome);
    assert.equal(result.logicalProof, outcome === 'succeeded');
  }
});

test('annotation payloads consume the unchanged evidence budget rather than being filtered out', async () => {
  const large = { ...system(), text: 'x'.repeat(2048) };
  const f = fixture({ after: [idle(), large, user()] });
  const result = await run(f, { maxBytes: 1000 });
  assert.equal(result.logicalProof, false); assert.equal(result.native.status, 'unknown');
  assert.ok(result.health.issues.includes('evidence_byte_limit'));
});
