# Instrumented Memory artifact binding

This interface validates and stages fixed bytes. It never imports a payload, starts a runtime, or grants execution.
It does not change `oc-mem-arm/1`, the original locks, or the consumer and grading interfaces.

## Owner contract

The parent owner supplies the source pins, archive pins, patch pin, composition pins, and destination directory.
These inputs must come from reviewed records, not model output, scratch files, project configuration, or environment flags.
The interface accepts archive buffers and an explicit map of outside bytes. It accepts no import URL or source directory.

Commit and tree provenance rests on the reviewed owner pins. Archive bytes alone cannot prove Git ancestry.
The validator checks the declared parent relationship, archive digests, exact member sets, per-file digests, and the common patch transformation.
It contains no fixed derivative-tuple allowlist and no identity override.

The binding digest identifies the whole composition, including every outside file. A composer file digest alone does not identify the composition.
The caller must retain the binding digest in the parent-owned record. A digest from an untrusted manifest is not a trust anchor.

## Interface

The exports are in `src/run/mem-instrumented-binding.mjs`:

| Export | Result |
|---|---|
| `inspectInstrumentedArchive(archive, pin)` | Archive integrity and strict closure inspection without a dependency exception |
| `buildInstrumentedBinding(ownerSpec, fixedInputs)` | A closed binding and its SHA-256 digest |
| `validateInstrumentedBinding(binding, fixedInputs, expectedDigest)` | Full integrity validation against the parent-owned digest |
| `stageInstrumentedBinding(binding, fixedInputs, target)` | A new, digest-named directory with validated bytes |
| `validateStagedInstrumentedBinding(binding, fixedInputs, target)` | Full input validation plus exact staged paths and bytes |

`pin` has exactly `archive_sha256` and `files`. The latter maps each package-relative path to its SHA-256 digest.

`fixedInputs` has this shape:

```js
{
  arms: {
    baseline: { parentArchive: Buffer, derivativeArchive: Buffer },
    candidate: { parentArchive: Buffer, derivativeArchive: Buffer },
  },
  patch: Buffer,
  outside: new Map([/* [relativePath, Buffer] for every outside file */]),
}
```

`target` has exactly `binding_sha256` and `owner_directory`.
The directory must already exist, belong to the current user, and have no group or other permissions.
Its absolute path must contain no symlink. The owner must exclude concurrent writers throughout staging and validation.

Staging creates `<owner_directory>/<binding_sha256>` exclusively. An existing destination causes refusal, even when its bytes match.
The validator completes all input checks before the first write. A write error removes only the newly created destination.
The output contains `binding.json`, `injection.patch`, both derivative directories, and the `outside` directory.
Files have mode `0400`. The owner can still alter them, so staged validation remains necessary before later use.

```js
const built = buildInstrumentedBinding(ownerSpec, fixedInputs)
// The parent owner retains and reviews built.sha256 separately.
const target = { binding_sha256: ownerRecordedDigest, owner_directory: ownedDirectory }
validateInstrumentedBinding(built.binding, fixedInputs, ownerRecordedDigest)
const staged = stageInstrumentedBinding(built.binding, fixedInputs, target)
validateStagedInstrumentedBinding(built.binding, fixedInputs, target)
// No loader call follows. This interface supplies no execution authorization.
```

## Closed schema

`mem-instrumented-schema.mjs` defines `oc-mem-instrumented-comparison/1` and its schema digest.
The builder adds `schema` and `schema_sha256`. Every other binding field comes from `ownerSpec`.
The executable schema rejects missing fields and unknown fields, including approval booleans.

| Field | Contents |
|---|---|
| `purpose` | `paired-instrumented-source` or `finite-synthetic-fixture` |
| `factory` | Exactly `{path: "src/index.js", export: "createMemoryPlugin"}` |
| `arms.baseline`, `arms.candidate` | Separate parent and derivative identities |
| `patch` | `sha256` and exactly `paths: ["src/index.js", "src/runtime.js"]` |
| `composition` | All outside file pins, role paths, builtin allowance, dependency profiles, and qualification citation |

Each `parent` contains `repository`, a full `commit`, a full `tree`, and `reference`.
Each `reference` contains `role`, `archive_sha256`, and `files`.
Each `derivative` contains a full `commit`, `parent`, full `tree`, `archive_sha256`, and `files`.
The two derivatives cannot share an archive identity or commit. The two arms cannot share a parent commit.

For `paired-instrumented-source`, both baseline archives contain exactly 192 files. Both candidate archives contain exactly 203 files.
The baseline reference role is `synthetic-source-reference-not-release`. The candidate reference role is `original-candidate-release-reference`.
The synthetic baseline reference does not replace the missing historical release archive. Old historical-release gates remain unchanged.

Finite fixtures use `synthetic-fixture-reference` for both references. This purpose makes no release or untouched-original claim.

The same patch buffer must reproduce both derivatives from their respective parent archives.
Only `src/index.js` and `src/runtime.js` can change. Both files must change, and every other file must remain byte-identical.
The patch parser requires exact context and line counts. It does not use fuzzy matching or run Git.
New product increments require a separately reviewed identity and transformation contract. This version does not silently expand the two-file patch scope.

`composition.files` maps every outside path to its digest.
`composition.roles` requires paths for `composer`, `addon`, `bridge`, `gate`, `fixture`, `rules`, `schema`, `descriptions`, and `operation_plan`.
Each role path must exist in `composition.files`. The outside byte map must match that file set exactly.

`composition.node_builtins` contains an explicit list of valid `node:` specifiers. Its default is empty, not all Node builtins.
`composition.dependency_profiles` must be empty for paired-source bindings. No real external-dependency exception is approved by this interface.

`composition.native_qualification` is either `null` or a citation with `evidence`, `source`, and `runtime`.
The evidence path must identify a manifested outside file.
The source pin contains `repository`, `commit`, and `tree`. The runtime pin contains `name`, `version`, and `sha256`.
The interface records this citation but does not establish that the qualification occurred or passed.

## Finite dependency fixture

Only `finite-synthetic-fixture` permits `immutable-file-closure/1` profiles. This facility tests closure binding, not an actual runtime resolver.
No profile imports code or resolves a package in the host environment.

The closed profile fields are:

| Field | Contents |
|---|---|
| `kind` | `immutable-file-closure/1` |
| `arm` | `baseline` or `candidate`, at most one profile per arm |
| `specifier` | Exactly `@opencode/util/global` |
| `issuer` | Exactly `path: "src/plugins/locate.js"` and the issuer `sha256` |
| `site` | UTF-8 byte `offset`, byte `length`, and `sha256` of the complete literal import expression |
| `entry` | An exact `.js` or `.mjs` file in the dependency closure |
| `files` | The complete dependency file map, also included in the outside file map |
| `resolver` | `path` and `sha256` of the inert JSON resolution rules |
| `source` | `repository`, full `commit`, and full `tree` |
| `runtime` | `name`, `version`, and `sha256`, as identity data only |

The resolution JSON repeats `arm`, `specifier`, `issuer`, `site`, `entry`, `files`, `source`, and `runtime` exactly.
Its schema is `oc-mem-exact-resolution/1`. The file is data, not resolver code.
Every dependency module must close within its own file map and the explicit builtin allowance.
An escape into a different manifested add-on still fails. An unused profile, altered site, missing file, or altered rule also fails.

## Validation limits

The archive reader accepts bounded gzip archives with regular USTAR members only.
It refuses links, duplicate members, hidden paths, traversal, project instructions, unsupported headers, truncation, and unexpected trailing data.
The reader preserves every manifested member. It never silently discards files outside an old path filter.
It supports literal positive `package.files` paths and literal exclusions, not glob patterns.

The closure scanner is a conservative lexical checker, not a full JavaScript parser or a security sandbox.
It supports ordinary literal static imports, exports with `from`, and the exact finite-fixture dynamic import site.
It refuses templates, regex/division syntax, escaped import specifiers, escaped identifiers, and unbound dynamic imports.
Unsupported syntax causes `unsupported_module_syntax`, not permission to proceed.
It does not establish JavaScript syntax validity, effect safety, or the absence of generated code.

The checker does not claim that a future product archive passes merely because its external probe was removed.
Future payloads still require reviewed owner pins, full closure validation, and any necessary separately reviewed parser work.
There is no fallback that skips unsupported syntax.

Successful results contain `archive: "verified"`, `closure: "complete"`, and `runtime: "not-qualified"`.
Qualification is either `absent` or `claim-recorded-unverified`.
An archive-only closure refusal carries `archive: "verified"`, `closure: "incomplete"`, and an error `code`.
Neither result authorizes a native run or satisfies an acceptance gate.

The old 471/694 derivatives and their two reference archives still fail with `unapproved_external_dependency`.
No new product identity, unavailable-host proof, or native qualification is included here.

## Offline tests

```sh
node --test test/mem-instrumented-binding.test.mjs test/mem-arm.test.mjs
```

The fixtures use buffers and temporary directories. Payload code never runs.
The tests cover complete staging, staged validation, exact patch reproduction, metadata tampering, archive escapes, dependency escapes, and qualification separation.
