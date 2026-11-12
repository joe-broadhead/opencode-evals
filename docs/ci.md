# CI and the gate

## The gate

`evals check --plugin <id>` runs, in order:

1. **T0** — the static checks that need nothing but a checkout.
2. **T-G** — the gold cases, which test the graders.
3. **T1** — every check the configuration makes runnable: the in-process host always; the stock binary when
   `OPENCODE_BIN_<version>` is set; the shaper case when the plugin's fake is configured.

It exits **0** when everything it ran passed (or was reported `unsupported` for a missing dependency) and
**non-zero** on a blocker: a T0 error-severity failure, a gold case that does not reproduce its known
verdict, or a T1 check that fails.

A check that cannot run is `unsupported`, never a pass. That is why the gate is safe on a machine without
a stock binary: it runs less, and says so.

## A plugin's own `npm run check`

Each plugin's `scripts/check.mjs` already runs its stages under the family's slot. Add one stage at the end:

```js
// scripts/check.mjs — the last stage
{
  name: "evals",
  run: () =>
    run("node", ["../opencode-evals/bin/evals", "check", "--plugin", "x"], {
      env: {
        // The directory that holds your plugin checkouts, e.g. $HOME. CI sets neither, and the checks that
        // need a checkout report `unsupported` instead of guessing a path.
        EVALS_PLUGIN_ROOT: process.env.EVALS_PLUGIN_ROOT,
        EVALS_SDK_DIR: process.env.EVALS_SDK_DIR,
        EVALS_STORE: process.env.EVALS_STORE,
      },
    }),
}
```

Run it through the machine-wide slot like the host and pack stages, because T1 starts a server:
`bash "$EVALS_WITH_SLOT" node ../opencode-evals/bin/evals check --plugin x`.

## GitHub Actions

`.github/workflows/ci.yml` runs two jobs:

- **test**: `node --test test/*.test.mjs` on Node 22, plus `evals selftest` and `evals compile --check`.
- **privacy**: `evals privacy --scan`, which reads the tree and the whole git history.

`evals pack` in CI verifies the committed snapshots in `packs/`: schema, digest, counts, the family's
invariants and the scripted cases. It does not need a plugin checkout, which is why the four plugins that
are not on GitHub are still covered. On a machine with checkouts the same command reports drift between a
plugin's live `jelly` declaration and its snapshot; `evals pack --sync` refreshes a snapshot after review.

Both are deterministic and need no secrets. The T1 tier is not in CI: it needs a stock binary, which is a
machine-level asset. Run it on the machine that has one, or add a job that downloads it and sets
`OPENCODE_BIN_2_2_6`.

## Before the first publish

```sh
evals privacy --scan          # tree and history must both be clean
evals privacy --scan --history-only
git rev-list --all | wc -l    # what will be published
```

If the history ever held a trace, a recording or a path from the private store, the scan fails and names
the commit. Rewriting the history is the only fix: a squashed commit still carries its blobs.
