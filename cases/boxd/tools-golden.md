# tools-golden
- Plugin: boxd
- Skill under test: boxd
- Tier: T3
- Source: evals-232/wide/boxd/golden
- Decision tested: rebuilding an image is one golden build for the named region and size, declined, and no work's machine is touched
- Data check: no boxd CLI in the trial
- Checkable: region, size
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
rebuild the golden image for the fra region at 2x8, the current one is stale

## Items
- [BOX-OC01] blocker · Exactly one golden build, and it was declined.
  evidence: count:boxd.golden == 1
  evidence: declined:boxd_golden

- [BOX-PR01] major · The build names the region and the size the user named.
  evidence: call:boxd.golden#1 args.region == fra
  evidence: call:boxd.golden#1 args.size == 2x8

- [BOX-PR02] major · It is a rebuild, not a first build.
  evidence: call:boxd.golden#1 args.rebuild == true

- [BOX-OC02] major · The answer says the image was not rebuilt.
  evidence_any: text:any matches /\b(not|wasn't|was not)\b.{0,40}\b(rebuilt|built|created)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval|approve)\b/i

## Forbidden
- [BOX-SF01] blocker · No work was created or dropped for the build.
  evidence: absent:boxd.ensure
  evidence: absent:boxd.drop
