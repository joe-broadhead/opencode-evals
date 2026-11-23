# Parent-owned Docker process transport

`src/run/owned-docker-process.mjs` implements the private `spawn(binary, args, options)` seam used by `createOwnedDockerClient`.
It does not install that seam in the production parent.
Default `processAdapter().owned.snapshot` and `.spawn` remain null.
Native qualification, completion, and successor admission remain false.

## Interface and trust

The factory accepts parent-owned data:

```js
createOwnedDockerProcess(
  { binary, config, context, plan, credentialValues },
  { spawn, readIdentity, readFile, platform }, // optional trusted dependencies
)
// => Object.freeze({ qualified: false, reason: "native-transport-unqualified", spawn })
```

`binary` is the pinned absolute Docker executable.
`config` is the dedicated absolute Docker configuration directory.
`context` is exactly `colima-mem-evals-20261122`.
`plan` is the parent-owned plan that `containTrial` receives.
`plan.credentialNames` must be exactly `["OPENCODE_API_KEY"]`, and `plan.descriptor.options.auth` must be `env:OPENCODE_API_KEY`.
`credentialValues` contains only `OPENCODE_API_KEY` and its in-memory value.
Other names, extra mappings, or mismatched auth fail at construction with `owned-docker-credential-refused`, before native effects.
Future credential names require a separately approved contract; this factory is not a general credential manager.
The factory copies the plan and credentials before it accepts calls.

These arguments are not an approval interface for untrusted callers.
The parent must hold immutable executable, configuration, staged-path, and image pins for the transport lifetime.
The factory does not discover, read, authenticate, or freeze those external resources.
A path or a configuration string does not prove a local endpoint or helper absence.
No manifest field, environment flag, or boolean changes `qualified:false`.

## Closed command protocol

The accepted grammar comes from `owned-containment.mjs`:

| Command | Constraint |
| --- | --- |
| `network create` | Exact egress/trial names, bridge driver, and isolated internal gateway flags |
| `create` | Exact proxy/workload limits, mounts, image, user, environment, and command from the captured plan |
| `network connect` | Exact `egress` alias and two full IDs |
| `inspect`, `network inspect`, `start`, `logs` | One full 64-hex ID |
| `exec` | Exact bootstrap path, work directory, stdin flag, and environment names |
| `stop`, `rm`, `network rm` | Exact existing cleanup flags and one full ID |

Every call includes the fixed context.
Unexpected executables, commands, flags, short IDs, mounts, process configuration, or environment entries fail before native spawn.
The adapter does not change the default context, start services, use a shell, or create a process group.
The parent still owns resource-ID authority through successful creation receipts.
An accepted argument shape does not grant resource ownership.

Non-exec calls receive only `PATH=/usr/bin:/bin` and the dedicated `DOCKER_CONFIG`.
Exec calls receive the exact fixed inner environment from `containTrial`, plus the designated credential and a parent-generated password.
Docker needs those explicit values for its name-only `-e` protocol.
Thus exec uses the fixed container PATH and `/work/home`, not the host PATH or user HOME.
No environment value comes from `process.env`.
Docker configuration remains host-only, and secrets do not enter argv.

## Child lifetime and bytes

The returned handle exposes the original stdout/stderr streams without another output buffer or decoder.
The existing client owns aggregate output limits, UTF-8 decoding, privacy, operation deadlines, stop grace, and immutable command results.
The adapter forwards actual child errors, first exit, and first aggregate close.
It does not synthesize exit or close after spawn failure or a signal request.
Stream EOF, process exit, direct-client closure, and remote resource absence remain separate facts.

Bootstrap stdin accepts one matching descriptor, at most 65536 bytes.
The adapter copies those bytes and waits for the native spawn event and initial identity.
Then it calls the original writable's `end` once.
Node owns writable backpressure, and drain events never resend the descriptor.
Cancellation or identity loss before delivery releases the buffered input without delivery.
Cancellation cannot retract input that the native stream already accepted.
Premature stdin close, failed end completion, or known unfinished input at child exit/close emits `owned-docker-input-lost` before forwarding that child event.
The adapter releases queued input on loss. Normal Writable finish/close is not loss.
Writable completion proves only local delivery, not remote bootstrap acknowledgement.

The existing client requests `SIGTERM`, then `SIGKILL` after its bounded grace.
The adapter accepts each stage at most once, only through the original child handle.
With a synchronous reader, it retains only the latest requested stage before the spawn event.
With an identity owner, cancellation before initial identity prevents later input and signals.
Each signal requires a fresh matching PID/start identity and a still-live original handle.
Identity loss refuses signals and marks output uncertain through the existing client error path.
No caller-supplied PID, process-name search, group signal, or descendant discovery supplies authority.

A pre-aborted containment call never invokes spawn.
Later containment cancellation uses the existing client stop interface.
The adapter adds no caller AbortSignal protocol, timer, or global process registry.
The private async seam creates its own AbortController for each lookup.
The parent owns admission and cleanup order.

## Native limits

The default native launcher is `node:child_process.spawn`, used only inside an explicit factory call's spawn method.
The default identity reader supports Linux `/proc/<original-pid>/stat` field 22.
It rejects missing, malformed, changed, or dead-process identity.
The closing comm parenthesis must have the exact space delimiter before the state fields.
This follows the existing `container.processStart` field convention, but does not use its permissive liveness fallback.
Other hosts, including macOS, refuse the default identity path before native spawn.
A trusted injected identity reader is a test or future integration dependency, not native qualification.
The optional `identityOwner` dependency supports asynchronous identity with separate helper ownership.
Plain `readIdentity` thenables still refuse identity. The original negative controls remain unchanged.
See [Darwin identity ownership](darwin-process-identity.md) for the offline interface and unexecuted native gates.

The PID/start read is not an atomic incarnation capability.
Identity acquisition occurs after native spawn and does not prevent the CLI from starting.
The pre-signal read does not prove absence of a kernel check-to-signal race.
Separate native evidence must establish the supported direct-child lifetime behavior.

Root exit and stream closure do not prove that SSH, credential helpers, plugins, descendants, containers, or remote jobs stopped.
The factory never certifies their absence.
Unverified helper or endpoint behavior remains `native-transport-unqualified`.
The trusted owner must refuse integration until the fixed local transport and no-helper assumptions have independent native evidence.
There is no automatic service start or fallback to another endpoint.

The offline tests use fake children, clocks, and identity reads through the actual client and containment command producer.
They do not qualify native Docker, stdin scheduling, helper absence, process identity, remote cancellation, or kernel pre-cancellation output.
Independent review and separately authorized native probes remain necessary before integration or use.
