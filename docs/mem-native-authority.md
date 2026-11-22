# Opt-in native invocation authority

## Status

This module implements an offline authority state machine for the synthetic Memory evaluation.
It does not install a host hook, transform an executor, or enable production configuration.
The legacy guard, runner, CLI, observer producer, discovery generator, and frozen requests remain unchanged.
Live integration and independent review remain separate gates.

## Policy semantics

`oc-mem-intent/1` remains an exact-payload allowlist. It does not acquire implicit quotas.
The new `nativeOperationPlan(intent)` function produces an explicit `oc-mem-operation-uses/1` companion.
Unknown mutation intents return `null`. Empty write allowlists produce no mutation uses.
The constructor rejects a missing, modified, or unsupported companion.

Each use has a stable `id`, `maxUses:1`, and accepted `alternatives`.
The grant identity includes the case, trial ID, turn, and operation ID.
An alternative does not add another use.

| Core case | Turn | Use | Alternatives or dependency |
| --- | --- | --- | --- |
| `core-durability` | 1 | `memory.remember` | Existing exact remember payload |
| `core-forget` | 1 | `memory.remember` | Existing exact remember payload |
| `core-forget` | 2 | `memory.forget` | Stored `@created.memory` |
| `core-wiki-write` | 1 | `wiki.create` | Both existing create forms share this use |
| `core-wiki-write` | 1 | `wiki.write` | Stored `@created.wiki`, after either create form |
| `core-wiki-write` | 2 | `wiki.append` | Stored `@created.wiki` |

The existing wiki presentation equivalence remains in force.
The independent write use remains available after either create form, including create with initial content.
The dependency is the stored creator binding, not model source or invocation order.

The twelve discovery mutations have literal companion entries.
Each row includes its named case and its `-p` variant:

| Case | Use | Frozen request source |
| --- | --- | --- |
| `commit-mem-memory` | `memory.remember` | `packs/mem/cases.mjs:7` |
| `commit-mem-page` | `page.write` | `packs/mem/cases.mjs:8` |
| `commit-mem-commitment` | `commitment.add` | `packs/mem/cases.mjs:9` |
| `commit-mem-wiki-write` | `wiki.write` | `packs/mem/cases.mjs:10` |
| `deep-mem-sources` | `sources.request` | `packs/mem/cases.mjs:17`, accepted synthetic bind in `mem-discovery-intents.mjs` |
| `deep-mem-jobs` | `jobs.draft` | `packs/mem/cases.mjs:18`, accepted synthetic draft in `mem-discovery-intents.mjs` |

The builder compares literal arguments. It does not derive counts from `spec.write`, lists, source text, or alternative count.
All current discovery write cases have explicit entries. Other mutation cases remain unsupported.

## Trusted control interface

`createNativeAuthority(policy, adapters)` is a private, runner-owned capability.
The policy includes `memoryIntent`, `memoryOperationPlan`, and the existing contained binding and write policy.
The factory clones the policy. Later caller mutations cannot change its authority.

The adapters are synchronous trusted readers: `readActivation`, `readScopes`, and `readCompletion`.
Promises and other thenables refuse immediately and revoke the active authority.
The gate observes their rejection but never uses their asynchronous results. It installs no global rejection handler.
Recursive entry into the same reader also revokes authority.
They are not tool arguments, environment opt-in booleans, or model-callable RPC methods.
The runner must keep one authority instance for the entire trial, including all turns.
If that instance loses its ledger, the runner must revoke the trial rather than recreate its budget.

`open()` reads and validates the activation, then returns an opaque in-process proof.
`verifyAuthority({action:'open',proof,generation})` returns the verified `{generation,scope}`.
A serialized proof, copied object, or scope-shaped assertion cannot open a scope.

The required activation record is:

```js
{
  schema: 'oc-mem-native-activation/1',
  case_id, trial_id, trial, turn, session,
  activation_id, incarnation, generation, active: true,
}
```

`trial`, `turn`, and `incarnation` are positive safe integers.
The identity strings must be nonempty. The case, trial ID, turn, and session must satisfy the existing sealed intent.
The runner must supply numeric trial and incarnation. The module does not invent them from counters or observations.
Later activations require strictly increasing turn and incarnation. The numeric trial cannot change within an instance.
The observer scope maps the provisioned native `session` to `sessionID`.

`cancel()` revokes the active scope. `close()` also prevents future opens.
Neither method replenishes uses or terminates native work by itself.

## Executor and permission interface

`execute({native,tool,input,occurrence?}, delegate)` is the outer protected-executor gate.
`native` contains the actual `{sessionID,messageID,id}` carrier fields.
The gate validates classification, existing policy, payload, target, creator evidence, activation, and expiry.
Each mutation also requires a matching write-policy entry with its Memory-family extractor and an explicit allowed target.
A generic known-tool pass, payload extractor, or `local:true` entry cannot replace that authorization.
Missing mutation entries refuse before reservation or delegation. Read behavior and the generic legacy policy remain unchanged.
It atomically consumes one matching mutation use before it calls `delegate(execution)`.
There is no await between the consumption and delegation.

Mutations never overlap. Reads can overlap and have no mutation budget.
End, error, no-op, decline, cancellation, and new occurrence IDs never replenish a mutation use.
The delegate result and rejection reason pass through unchanged.

The optional `occurrence` is evidence correlation only. It is not required for authorization.
The outer gate can reserve before the inner observer allocates its own occurrence ID.
The gate's private `invocation_id` identifies its entry. It is not a fabricated observer or native ID.
The observer links its own occurrence through the reservation evidence.

The private `execution` capability exposes `receipt()`, `bindRequest(request)`, and `cancel()`.
`receipt()` returns a fresh scoped snapshot or `null`. A snapshot is not a live revocable capability.
The trusted transport must obtain it immediately before protected dispatch and must reject a null receipt.
The fixture recorder observes effects. It cannot replace this pre-effect authorization check.

The request bridge supplies:

```js
{ requestID, sessionID, action,
  source: { type: 'tool', id, messageID }, resources }
```

`execution.bindRequest(request)` binds a reliable native request ID exactly once to that entry.
One entry supports one request. Multiple permission requests within one executor remain unsupported and refuse.
The same request ID cannot bind a successor, including after termination.
Mutation resources must belong to the validated target or input identifiers.
`evaluate({...request,effect})` accepts only the exact binding. Exact dotted Memory aliases remain supported.
Ask suspends the receipt. Deny revokes it permanently. A matching live allow can resolve an ask.

`reply(request, send)` uses the existing bounded reply policy and resource checks.
It captures the binding before the asynchronous native reply. It never searches for a successor after that await.
It also captures the exact pending transition revision. Every accepted ask, allow, deny, or reply transition advances that revision.
An older reply cannot resolve a newer ask. An older send error cannot overwrite a newer permission decision.
It sends at most one `once` reply per request. A transport error, racing denial, or late completion cannot restore a receipt.
A `reject` return requires the runner adapter to reject or cancel the native request.
The adapter must prevent effects after native cancellation or a late reply. That host behavior still requires qualification.

Carrier-only permission association is unsupported, even for sequential reuse.
Unbound or ambiguous permissions refuse and conservatively revoke active entries in that session.
This can refuse unrelated concurrent reads. It never selects a latest entry to authorize.

## Read-only observer evidence

`readReservation({scope,native,tool})` returns `{grant_id,reservation_id}` only for one live, unsuspended mutation entry.
It creates no grant, reservation, or consumption. An activation check can revoke stale authority.
No match, a read-only entry, or ambiguous same-tool entries return `null`.
The returned IDs remain separate from native carrier and observer occurrence IDs.

The observer candidate's optional lookup cannot distinguish a read without a grant from unavailable evidence.
Mixed read/write observation must omit that optional lookup or add a qualified distinction during later integration.
The authority module must not fabricate read grants to satisfy that interface.

`facts()` returns independent attempt, refusal, reservation, request, and lifecycle snapshots.
Those facts do not certify observer coverage or native quiescence.

## Seal and fixture records

Seal verification requires the original proof, exact generation and scope, and no live delegates.
It also requires this record from `readCompletion`:

```js
{
  schema: 'oc-mem-native-completion/1', generation, scope,
  terminal: { sessionID, messageID, status: 'completed' },
  dispatch: { closed: true, outstanding: 0 },
  audit: { status: 'clean' },
}
```

Only the qualified native owner can supply this record.
The gate captures the active scope before the completion reader and validates that same scope immediately after the reader returns.
Close, cancellation, activation replacement, or recursive completion reads cannot produce a sealed certificate.
Control changes during activation reads cannot reopen a cancelled scope. Scope refresh cannot transfer an executor attempt to a successor scope.
Request booleans, an empty receipt, and zero local pending entries cannot replace it.
A successful seal consumes the active scope. Late entry then refuses.

The new fixture receipt has schema `oc-mem-native-receipt/1`.
It includes activation, trial, incarnation, generation, native carrier, invocation ID, exact arguments, expiry, operation ID, grant ID, and reservation ID.
An optional observer occurrence remains separate.
The recorder validates the new scope fields and retains reservation identity in `oc-mem-native-creator/1` evidence.
The gate compares each creator with its own retained reservation and exact admitted arguments.
Foreign, denied, pending, cancelled, and failed creator reservations cannot unlock another use.
Invalid bindings still leave independent backend operation facts marked `unbound`.
Legacy receipt handling remains unchanged.

## Integration work still required

The runner must own the new activation fields, trial ledger lifetime, and qualified completion records.
It must install the gate outside the observer and the actual selected executor.
It must connect native cancellation and an immutable request bridge before permission-bearing reuse can work.
It must route scoped live receipts to protected dispatch instead of the legacy single mutable receipt file.
The observer and authority generations must share the same qualified executor inventory.
The current legacy installer does not stage or enable these new modules.

The existing default replay fence remains intact.
Adding companion metadata to the legacy guard alone does not install the new authority gate.
No real host execution, complete-empty coverage, native terminal proof, or production permission is claimed.
