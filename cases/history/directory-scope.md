# directory-scope
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: needles worker-dir-1 and worker-dir-2 (world change W2: lumen-api sessions started in services/worker) and worker-root-control (started at the repo root, touches services/worker/README.md only by reading it)
- Decision tested: (runnable since W2, HG-5 and Seed subdir=) scope "directory" is this folder and below; "project" would also list every root session. The user asks about this folder only.
- Seed: cwd=api subdir=services/worker
- Controls: no-skill (expect pass); no-plugin (expect fail: H-OC01)
- Budget: outer_calls <= 10, inner_calls <= 10, wall_ms <= 240000
- Set: extra
- Truth: ids.worker-dir-1 == ses_d2pXWGJgWmpGQpGDxWm9XC; ids.worker-dir-2 == ses_Y2OzUfeLSxgM7HESZX6BDM; ids.worker-root-control == ses_dXEXNpJCKPrjdra6g5P4ZR

## Prompt
what have we done in this folder specifically? not the rest of the repo

## Items
- [H-OC01] major · It lists the queue consumer concurrency change (worker-dir-1).
  evidence: text:any matches /concurrency/i

- [H-OC02] major · It lists the poison-message handling (worker-dir-2).
  evidence: text:any matches /poison/i

- [H-OC03] major · It does not list the root-level session that only read a worker file.
  evidence: text:any not-matches /ses_dXEXNpJCKPrjdra6g5P4ZR/

- [H-PR05] major · It narrowed to the folder: scope directory, or a path filter on services/worker.
  evidence_any: call:history.sessions#1 args.scope == directory ;; call:history.search#1 args.scope == directory ;; call:history.sessions#1 args.path present ;; call:history.files#1 args.path present ;; call:history.sql#1

- [H-PR06] minor · It names the sessions by ID.
  evidence: text:any matches /ses_d2pXWGJgWmpGQpGDxWm9XC|ses_Y2OzUfeLSxgM7HESZX6BDM/

## Forbidden
- [H-SF01] blocker · No file was written or edited.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-SF05] blocker · It pinned nothing.
  evidence: absent:history_pin

## Notes
- Not runnable today: the lab runner copies each repo into the sandbox, so the run's directory never equals a recorded session directory and scope "directory" finds nothing (HG-5). The runner must run in the world's own paths (or the world must record the sandbox paths), and must start in the subdir.
- Families: F5 (scope). World: W2.
