import { createHash } from 'node:crypto';

// Logical public-client seam ONLY. No HTTP codec is qualified by the retained
// 2.2.6 CLI source. See docs/native-completion.md before integrating this module.
const PIN = 'dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06';
const CEILINGS = Object.freeze({ deadlineMs: 120_000, maxPages: 100,
  maxEvents: 10_000, maxBytes: 4_194_304, maxRawBytes: 8_388_608, closeMs: 1000 });
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512;
const fail = (code) => { throw new Error(code); };

/**
 * Observe one runner-controlled serial turn. launch is the caller's existing CLI
 * operation, not a native prompt client. It is called once, only after baseline,
 * quiescence and an actual server.connected event. It returns { binding, raw }.
 * Every client operation must honor the supplied AbortSignal and byte budget.
 * Returned evidence is private, provisional, wire-unqualified, never acceptance.
 */
export async function verifyNativeCompletion({ client, binding, launch, signal, limits = {} }) {
  const cap = { ...CEILINGS, deadlineMs: 30_000, ...limits };
  for (const [key, value] of Object.entries(cap)) {
    if (!(key in CEILINGS) || !Number.isSafeInteger(value) || value < 1 || value > CEILINGS[key])
      fail('invalid_limits');
  }
  const keys = ['caseID', 'trialID', 'turnID', 'activationID', 'incarnationID', 'sessionID'];
  if (!object(binding) || keys.some((key) => !id(binding[key])) ||
      binding.scope?.complete !== true || binding.scope?.serial !== true ||
      !Array.isArray(binding.scope.sessionIDs) || binding.scope.sessionIDs.length < 1 ||
      binding.scope.sessionIDs.length > 16 || binding.scope.sessionIDs.some((item) => !id(item)) ||
      new Set(binding.scope.sessionIDs).size !== binding.scope.sessionIDs.length ||
      !binding.scope.sessionIDs.includes(binding.sessionID) || typeof launch !== 'function') fail('invalid_binding');
  const bound = { ...Object.fromEntries(keys.map((key) => [key, binding[key]])),
    scope: { complete: true, serial: true, sessionIDs: [...binding.scope.sessionIDs] } };
  const sessionID = bound.sessionID;
  const result = {
    schema: 'mem-native-completion/1', phase: 'PROVISIONAL', binding: bound,
    source: { version: '2.2.6', commit: PIN },
    wire: { status: 'unqualified', reason: 'pinned_generated_schema_and_native_capture_required' },
    accepted: false, logicalProof: false,
    admission: { status: 'unknown' }, native: { status: 'unknown' },
    quiescence: { status: 'unknown' }, raw: { status: 'unknown' },
    health: { transport: 'available', stream: 'not_connected', close: 'unknown', issues: [] },
    evidence: [],
  };
  const controller = new AbortController();
  let rejectStop, stopping = false, stream, pump, window = false, bytes = 0, eventCount = 0;
  let connected = false, resolveReady;
  const deliveries = [], terminals = [];
  const stop = new Promise((_, reject) => { rejectStop = reject; });
  stop.catch(() => {});
  const issue = (code) => {
    const text = typeof code === 'string' ? code.slice(0, 160) : 'unknown_error';
    if (!result.health.issues.includes(text) && result.health.issues.length < 32) result.health.issues.push(text);
  };
  const abort = (code) => { issue(code); rejectStop(new Error(code)); controller.abort(); };
  const onAbort = () => abort('cancelled');
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timer = setTimeout(() => abort('deadline'), cap.deadlineMs);
  const bounded = (fn) => Promise.race([stop, Promise.resolve().then(() => {
    if (controller.signal.aborted) fail('aborted');
    return fn();
  })]);
  const options = () => ({ signal: controller.signal, maxBytes: cap.maxBytes - bytes });
  const retain = (kind, value) => {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) fail(`invalid_${kind}`);
    bytes += Buffer.byteLength(encoded);
    if (bytes > cap.maxBytes) fail('evidence_byte_limit');
    const copy = JSON.parse(encoded);
    result.evidence.push({ kind, value: copy });
    return copy;
  };
  const read = async (kind, fn) => {
    try { return retain(kind, await bounded(fn)); }
    catch (error) { result.health.transport = 'unavailable'; issue(`read_${kind}_unavailable`); throw error; }
  };
  const messages = async (kind) => {
    const all = [], seen = new Set(), cursors = new Set();
    let cursor;
    for (let n = 0; n < cap.maxPages; n++) {
      const input = cursor ? { sessionID, limit: 200, cursor } : { sessionID, limit: 200, order: 'desc' };
      const value = await read(kind, () => client.message.list(input, options()));
      if (!object(value) || !Array.isArray(value.data) || value.data.length > 200 || !object(value.cursor) ||
          (value.cursor.next != null && !id(value.cursor.next))) fail('invalid_message_page');
      for (const message of value.data) {
        if (!object(message) || !id(message.id) || !['user', 'assistant', 'idle'].includes(message.type) ||
            seen.has(message.id) || (message.sessionID !== undefined && message.sessionID !== sessionID))
          fail('invalid_message_identity');
        seen.add(message.id); all.push(message);
      }
      cursor = value.cursor.next;
      if (cursor == null) return all;
      if (cursors.has(cursor)) fail('repeated_cursor');
      cursors.add(cursor);
    }
    fail('message_page_limit');
  };
  const quiet = async (phase) => {
    // Source N:181-207: jobs → inbox → active, never a catch-to-empty fallback.
    const jobs = await read(`${phase}_jobs`, () => client.experimental.job.list({ sessionID, descendants: true }, options()));
    if (!Array.isArray(jobs)) fail('invalid_jobs');
    if (jobs.length) { issue('unexpected_jobs'); return { status: 'nonempty', at: 'jobs' }; }
    for (const ownedID of bound.scope.sessionIDs) {
      const inbox = await read(`${phase}_inbox`, () => client.session.inbox.list({ sessionID: ownedID }, options()));
      if (!Array.isArray(inbox)) fail('invalid_inbox');
      if (inbox.length) { issue('unexpected_inbox'); return { status: 'nonempty', at: 'inbox', sessionID: ownedID }; }
    }
    const active = await read(`${phase}_active`, () => client.session.active(undefined, options()));
    if (!object(active)) fail('invalid_active');
    if (Object.keys(active).length) { issue('unexpected_active'); return { status: 'nonempty', at: 'active' }; }
    return { status: 'empty' };
  };
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  try {
    if (controller.signal.aborted) fail('aborted');
    stream = client.event.subscribe({ ...options() })[Symbol.asyncIterator]();
    pump = (async () => {
      try {
        while (!stopping) {
          const next = await bounded(() => stream.next());
          if (stopping) return;
          if (next.done) fail('event_loss');
          if (++eventCount > cap.maxEvents) fail('event_limit');
          const event = retain('event', next.value);
          if (!object(event) || !id(event.type) || !object(event.data)) fail('invalid_event');
          if (event.type === 'server.connected') {
            if (connected) fail('event_reconnect');
            connected = true; result.health.stream = 'connected'; resolveReady(); continue;
          }
          if (event.type === 'session.inbox.delivered') {
            if (!window || !connected) issue('delivery_outside_window');
            if (event.data.sessionID !== sessionID || !id(event.data.inboxID)) issue('foreign_or_unknown_delivery');
            deliveries.push(event);
            if (deliveries.length !== 1) issue('multiple_deliveries');
          }
          if (event.data.sessionID !== undefined && !bound.scope.sessionIDs.includes(event.data.sessionID))
            issue('foreign_session_event');
          if (event.type.startsWith('session.execution.') && !id(event.data.sessionID))
            issue('unknown_session_event');
          if (/^session\.execution\.(succeeded|failed|interrupted)$/.test(event.type)) {
            if (!window || deliveries.length !== 1) issue('unbound_terminal_event');
            terminals.push(event);
          }
        }
      } catch (error) {
        if (!stopping) { result.health.stream = 'unavailable'; issue(error?.message); resolveReady(); }
      }
    })();
    await bounded(() => ready);
    if (!connected || result.health.issues.length) fail('stream_not_ready');
    // Observe the entire baseline/preflight window on the live subscription.
    // A delivery/loss during these reads invalidates the launch gate too.
    const baseline = await messages('baseline');
    const baselineIDs = new Set(baseline.map((item) => item.id));
    result.baseline = { messageIDs: [...baselineIDs] };
    result.preflight = await quiet('preflight');
    if (result.preflight.status !== 'empty') fail('preflight_not_empty');
    if (result.health.stream !== 'connected' || result.health.issues.length) fail('preflight_event_conflict');
    window = true;
    const receipt = await bounded(() => launch({ binding: structuredClone(bound), signal: controller.signal }));
    if (!object(receipt) || keys.some((key) => receipt.binding?.[key] !== bound[key]) ||
        receipt.binding?.scope?.complete !== true || receipt.binding?.scope?.serial !== true ||
        JSON.stringify(receipt.binding?.scope?.sessionIDs) !== JSON.stringify(bound.scope.sessionIDs))
      fail('launch_binding_disagreement');
    if (!(receipt.raw instanceof Uint8Array) || receipt.raw.byteLength > cap.maxRawBytes) issue('raw_byte_limit_or_missing');
    else {
      // Do not parse, normalize, append to, or rewrite the native CLI bytes.
      result.raw = { status: 'known', bytes: receipt.raw.byteLength,
        sha256: createHash('sha256').update(receipt.raw).digest('hex') };
    }
    try {
      await read('wait', async () => {
        const value = await client.experimental.session.wait({ sessionID }, options());
        return value === undefined ? null : value;
      });
    } catch {
      // A failed wait is NOT an empty/successful wait. Preserve independently
      // readable native negatives, with the transport failure still recorded.
      if (controller.signal.aborted) fail('aborted');
    }
    const projection = await messages('projection');
    const delivery = deliveries.length === 1 ? deliveries[0] : undefined;
    const promptID = delivery?.data.inboxID;
    const promptIndex = projection.findIndex((message) => message.id === promptID);
    const newUsers = projection.filter((message) => message.type === 'user' && !baselineIDs.has(message.id));
    const signature = (items) => items.map(({ id, type }) => [id, type]);
    const newCount = projection.length - baseline.length;
    const baselineIntact = newCount >= 0 &&
      JSON.stringify(signature(projection.slice(newCount))) === JSON.stringify(signature(baseline));
    if (!baselineIntact) issue('baseline_changed');
    if (!delivery || delivery.data.sessionID !== sessionID || baselineIDs.has(promptID) ||
        promptIndex < 0 || projection[promptIndex].type !== 'user' || newUsers.length !== 1 ||
        newUsers[0].id !== promptID || !baselineIntact || promptIndex !== newCount - 1) issue('prompt_not_corroborated');
    else {
      result.admission = { status: 'known', promptID };
      const firstIdle = projection.slice(0, promptIndex).reverse().find((message) => message.type === 'idle');
      if (firstIdle && ['succeeded', 'failed', 'interrupted'].includes(firstIdle.outcome)) {
        result.native = { status: 'known', promptID, idleID: firstIdle.id, outcome: firstIdle.outcome,
          ...(firstIdle.error !== undefined ? { error: firstIdle.error } : {}) };
      } else issue('native_idle_missing_or_invalid');
    }
    result.quiescence = await quiet('final');
  } catch (error) { issue(error?.message); }
  finally {
    stopping = true; window = false; clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    controller.abort(); rejectStop(new Error('closed'));
    await pump;
    let closeTimer;
    try {
      if (stream) {
        if (typeof stream.return !== 'function') fail('stream_return_missing');
        await Promise.race([
          Promise.resolve().then(() => stream.return()),
          new Promise((_, reject) => { closeTimer = setTimeout(() => reject(new Error('stream_close_deadline')), cap.closeMs); }),
        ]);
      }
      result.health.close = 'closed';
    } catch (error) { issue(error?.message); }
    finally { clearTimeout(closeTimer); }
  }
  if (deliveries.length !== 1 || result.health.issues.some((code) =>
    ['delivery_outside_window', 'foreign_or_unknown_delivery', 'foreign_session_event'].includes(code)))
    result.admission = { status: 'unknown' };
  if (result.native.status === 'known' && terminals.some((event) =>
    event.type !== `session.execution.${result.native.outcome}` || event.data.sessionID !== sessionID))
    issue('contradictory_terminal_event');
  result.logicalProof = result.admission.status === 'known' && result.native.outcome === 'succeeded' &&
    result.quiescence.status === 'empty' && result.raw.status === 'known' &&
    result.health.stream === 'connected' && result.health.close === 'closed' && result.health.issues.length === 0;
  return result;
}
