import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

// Logical public-client seam ONLY. No HTTP codec is qualified by the retained
// 2.2.6 CLI source. See docs/native-completion.md and the source-backed union
// classification in docs/native-completion-transcript.md before integration.
const PIN = 'dc2ffcf8bf26f9e669b6aa22b95f50e12be15e06';
const CEILINGS = Object.freeze({ deadlineMs: 120_000, maxPages: 100,
  maxEvents: 10_000, maxBytes: 4_194_304, maxRawBytes: 8_388_608, closeMs: 1000 });
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512;
const fail = (code) => { throw new Error(code); };
const modelRef = (value) => object(value) && id(value.id) && id(value.providerID) &&
  (value.variant === undefined || id(value.variant));
const locationRef = (value) => object(value) && id(value.directory) &&
  (value.workspaceID === undefined || id(value.workspaceID));
const movedLocation = (value) => object(value) && locationRef(value.location) &&
  (value.projectID === undefined || id(value.projectID)) &&
  (value.subpath === undefined || typeof value.subpath === 'string');
const annotation = (message) => ['agent-switched', 'model-switched', 'system'].includes(message.type);
const conflictingWork = (message) => ['synthetic', 'skill', 'shell', 'compaction', 'location-switched'].includes(message.type);
function supportedMessage(message) {
  // Preserve the original logical user/assistant seam. New native variants must
  // carry their source-required fields; none is converted to user/assistant/idle.
  if (['user', 'assistant'].includes(message.type)) return true;
  if (message.type === 'idle') return ['succeeded', 'failed', 'interrupted'].includes(message.outcome);
  if (!object(message.time) || !Number.isFinite(message.time.created) ||
      (message.metadata !== undefined && !object(message.metadata))) return false;
  switch (message.type) {
    case 'agent-switched':
      return id(message.agent) && (message.previous === undefined || id(message.previous));
    case 'model-switched':
      return modelRef(message.model) && (message.previous === undefined || modelRef(message.previous));
    case 'system':
    case 'synthetic':
      return typeof message.text === 'string' &&
        (message.description === undefined || typeof message.description === 'string');
    case 'location-switched':
      return movedLocation(message) && (message.previous == null || movedLocation(message.previous));
    case 'skill':
      return id(message.skill) && id(message.name) && typeof message.text === 'string';
    case 'shell':
      return id(message.shellID) && typeof message.command === 'string' &&
        ['running', 'exited', 'timeout', 'killed'].includes(message.status) &&
        (message.time.completed === undefined || Number.isFinite(message.time.completed)) &&
        (message.exit === undefined || Number.isFinite(message.exit)) &&
        (message.output === undefined || (object(message.output) && typeof message.output.output === 'string' &&
          Number.isFinite(message.output.cursor) && Number.isFinite(message.output.size) && typeof message.output.truncated === 'boolean'));
    case 'compaction':
      return ['auto', 'manual'].includes(message.reason) &&
        (message.model === undefined || modelRef(message.model)) &&
        (message.native === undefined || object(message.native)) &&
        (['running', 'completed'].includes(message.status) ? typeof message.summary === 'string'
          : message.status === 'failed' && object(message.error) &&
            typeof message.error.type === 'string' && typeof message.error.message === 'string');
    default: return false;
  }
}
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype), 'byteLength',
).get;
function rawViewBytes(raw) {
  try { return raw instanceof Uint8Array ? typedArrayByteLength.call(raw) : undefined; }
  catch { return undefined; } // Unsupported receivers have no trusted view length.
}

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
    health: { transport: 'available', stream: 'not_connected', close: 'unknown', fence: 'unknown', issues: [] },
    evidence: [],
  };
  const controller = new AbortController();
  let rejectStop, rejectPump, closing = false, stream, pump, window = false, bytes = 0, eventCount = 0;
  let connected = false, dispatched = false, resolveReady;
  const deliveries = [], terminals = [];
  const terminalIDs = new Set();
  const stop = new Promise((_, reject) => { rejectStop = reject; });
  stop.catch(() => {});
  // Main cancellation must not discard an already yielded next() result. The
  // pump has its own bounded close fence and is always joined before return.
  const pumpStop = new Promise((_, reject) => { rejectPump = reject; });
  pumpStop.catch(() => {});
  const issue = (code) => {
    const text = typeof code === 'string' ? code.slice(0, 160) : 'unknown_error';
    if (!result.health.issues.includes(text) && result.health.issues.length < 32) result.health.issues.push(text);
  };
  const reportError = (error) => {
    let message;
    try { message = error?.message; } catch { /* Diagnostics must not become a second failure. */ }
    issue(typeof message === 'string' ? message : 'unknown_error');
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
  const messages = async (kind, observe) => {
    const all = [], seen = new Set(), cursors = new Set();
    let cursor;
    for (let n = 0; n < cap.maxPages; n++) {
      const input = cursor ? { sessionID, limit: 200, cursor } : { sessionID, limit: 200, order: 'desc' };
      const value = await read(kind, () => client.message.list(input, options()));
      if (!object(value) || !Array.isArray(value.data) || value.data.length > 200 || !object(value.cursor) ||
          (value.cursor.next != null && (!id(value.cursor.next) || value.data.length === 0))) fail('invalid_message_page');
      for (const message of value.data) {
        if (!object(message) || !id(message.id) || !supportedMessage(message) ||
            seen.has(message.id) || (message.sessionID !== undefined && message.sessionID !== sessionID))
          fail('invalid_message_identity');
        seen.add(message.id); all.push(message);
      }
      // Only complete, validated pages extend the contiguous observed segment.
      // A later read failure must not erase a negative already bound here.
      observe?.(all);
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
    const subscription = client.event.subscribe({ ...options() });
    if (!subscription || typeof subscription[Symbol.asyncIterator] !== 'function') {
      // Refuse Promise-returning subscriptions, but own their rejection. Do not
      // await or adopt their eventual value as an asynchronous subscription.
      Promise.resolve(subscription).catch(() => {});
      fail('unsupported_subscription_shape');
    }
    stream = subscription[Symbol.asyncIterator]();
    pump = (async () => {
        while (true) {
          const next = await Promise.race([stream.next(), pumpStop]);
          if (next.done) {
            if (!closing) fail('event_loss');
            result.health.fence = 'complete';
            return;
          }
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
          if (event.type === 'session.execution.started' && !window)
            issue('execution_start_outside_window');
          if (/^session\.execution\.(succeeded|failed|interrupted)$/.test(event.type)) {
            if (id(event.id)) {
              if (terminalIDs.has(event.id)) issue('replayed_terminal_event');
              terminalIDs.add(event.id);
            }
            // A buffered terminal can finish delivery during close. Compare it
            // with the stored outcome after the fence, not with pump timing.
            if (!dispatched || deliveries.length !== 1) issue('unbound_terminal_event');
            terminals.push(event);
          }
        }
    })().catch((error) => {
      result.health.stream = 'unavailable'; reportError(error); resolveReady();
    });
    await bounded(() => ready);
    if (!connected || result.health.issues.length) fail('stream_not_ready');
    // Observe the entire baseline/preflight window on the live subscription.
    // A delivery/loss during these reads invalidates the launch gate too.
    const baseline = await messages('baseline');
    const baselineIDs = new Set(baseline.map((item) => item.id));
    result.baseline = { messageIDs: [...baselineIDs] };
    if (baseline.some((message) => ['shell', 'compaction'].includes(message.type) && message.status === 'running'))
      fail('baseline_unsettled_work');
    result.preflight = await quiet('preflight');
    if (result.preflight.status !== 'empty') fail('preflight_not_empty');
    if (result.health.stream !== 'connected' || result.health.issues.length) fail('preflight_event_conflict');
    window = true; dispatched = true;
    const receipt = await bounded(() => launch({ binding: structuredClone(bound), signal: controller.signal }));
    if (!object(receipt) || keys.some((key) => receipt.binding?.[key] !== bound[key]) ||
        receipt.binding?.scope?.complete !== true || receipt.binding?.scope?.serial !== true ||
        JSON.stringify(receipt.binding?.scope?.sessionIDs) !== JSON.stringify(bound.scope.sessionIDs))
      fail('launch_binding_disagreement');
    const raw = receipt.raw;
    const rawBytes = rawViewBytes(raw);
    if (rawBytes === undefined || rawBytes > cap.maxRawBytes) issue('raw_byte_limit_or_missing');
    else {
      // Do not parse, normalize, append to, or rewrite the native CLI bytes.
      result.raw = { status: 'known', bytes: rawBytes,
        sha256: createHash('sha256').update(raw).digest('hex') };
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
    const projection = await messages('projection', (segment) => {
      const delivery = deliveries.length === 1 ? deliveries[0] : undefined;
      const promptID = delivery?.data.inboxID;
      if (!id(promptID) || delivery.data.sessionID !== sessionID || baselineIDs.has(promptID)) return;
      const index = segment.findIndex((message) => message.id === promptID && message.type === 'user');
      if (index < 0) return;
      if (segment.some((message) => !baselineIDs.has(message.id) && conflictingWork(message)) ||
          segment.slice(index + 1).some((message) => !baselineIDs.has(message.id) && !annotation(message))) {
        result.native = { status: 'unknown' }; return;
      }
      const following = segment.slice(0, index).reverse();
      if (following.some((message) => message.type === 'user' || baselineIDs.has(message.id))) return;
      const firstIdle = following.find((message) => message.type === 'idle');
      if (firstIdle && ['failed', 'interrupted'].includes(firstIdle.outcome)) {
        result.native = { status: 'known', promptID, idleID: firstIdle.id, outcome: firstIdle.outcome,
          ...(firstIdle.error !== undefined ? { error: firstIdle.error } : {}) };
      }
    });
    const delivery = deliveries.length === 1 ? deliveries[0] : undefined;
    const promptID = delivery?.data.inboxID;
    const promptIndex = projection.findIndex((message) => message.id === promptID);
    const newUsers = projection.filter((message) => message.type === 'user' && !baselineIDs.has(message.id));
    const newCount = projection.length - baseline.length;
    const workConflict = projection.some((message) => !baselineIDs.has(message.id) && conflictingWork(message));
    if (workConflict) issue('conflicting_transcript_work');
    const baselineIntact = newCount >= 0 &&
      isDeepStrictEqual(projection.slice(newCount), baseline);
    if (!baselineIntact) issue('baseline_changed');
    if (!delivery || delivery.data.sessionID !== sessionID || baselineIDs.has(promptID) ||
        promptIndex < 0 || projection[promptIndex].type !== 'user' || newUsers.length !== 1 ||
        newUsers[0].id !== promptID || !baselineIntact || workConflict || promptIndex >= newCount ||
        !projection.slice(promptIndex + 1, newCount).every(annotation)) issue('prompt_not_corroborated');
    else {
      result.admission = { status: 'known', promptID };
      const firstIdle = projection.slice(0, promptIndex).reverse().find((message) => message.type === 'idle');
      if (firstIdle && ['succeeded', 'failed', 'interrupted'].includes(firstIdle.outcome)) {
        result.native = { status: 'known', promptID, idleID: firstIdle.id, outcome: firstIdle.outcome,
          ...(firstIdle.error !== undefined ? { error: firstIdle.error } : {}) };
      } else issue('native_idle_missing_or_invalid');
    }
    result.quiescence = await quiet('final');
  } catch (error) { reportError(error); }
  finally {
    closing = true; window = false; clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    let closeTimer;
    try {
      const closeDeadline = new Promise((_, reject) => {
        closeTimer = setTimeout(() => {
          rejectPump(new Error('stream_fence_deadline'));
          reject(new Error('stream_close_deadline'));
        }, cap.closeMs);
      });
      // Abort/return must seal ingress without silently dropping buffered
      // frames. Continue ordered next() calls until EOF or explicit failure.
      controller.abort(); rejectStop(new Error('closed'));
      if (stream) {
        const close = Promise.race([
          Promise.resolve().then(() => {
            if (typeof stream.return !== 'function') fail('stream_return_missing');
            return stream.return();
          }),
          closeDeadline,
        ]).then(() => { result.health.close = 'closed'; }, reportError);
        // Iterator cleanup is independent of pump settlement, even if a future
        // pump change rejects. Both operations share the same bounded grace.
        try { await pump; }
        catch (error) { result.health.stream = 'unavailable'; reportError(error); }
        finally { await close; }
      } else result.health.close = 'closed';
    }
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
    result.health.stream === 'connected' && result.health.close === 'closed' &&
    result.health.fence === 'complete' && result.health.issues.length === 0;
  return result;
}
