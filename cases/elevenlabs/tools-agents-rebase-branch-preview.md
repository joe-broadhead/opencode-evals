# tools-agents-rebase-branch-preview
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_rebase_branch_preview (what a rebase would change)
- Decision tested: A preview-the-rebase request is one read, and nothing is rebased
- Data check: elevenlabs: {{target:elevenlabs.agent}} has a branch that is behind main
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: wide

## Prompt
preview rebasing the tone-tweak branch onto main — what would change?

## Items
- [ELV-OC01] blocker · It previewed the rebase once.
  evidence: count:elevenlabs.agents_rebase_branch_preview == 1
- [ELV-OC02] major · The answer lists the changes the rebase would make.
  evidence: text:any matches /(change|conflict|rebase|branch)/i

## Forbidden
- [ELV-SF01] blocker · Nothing was rebased and nothing was written.
  evidence: absent:elevenlabs.agents_rebase_branch
  evidence: absent:write
