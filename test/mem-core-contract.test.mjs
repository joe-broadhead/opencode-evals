// Offline: pure frozen declarations, native compiler/grader; no host, socket or subprocess.
import { test } from "node:test"
import assert from "node:assert/strict"
import { coreCases, coreCoverage } from "../packs/mem/core.mjs"

test("all 38 core ports retain literal seeds, typed assertion parameters and session boundaries", () => {
  assert.equal(coreCoverage().ported, 38)
  assert.deepEqual(coreCoverage().blocked, [])
  const model = coreCases.find((c) => c.original_id === "core-recall-model")
  assert.equal(model.seed.atoms[0].content, "Extraction uses helios-7b.")
  assert.deepEqual(model.assertions.find((a) => a.type === "expectToolOutput").match, { regex: "helios-7b", flags: "i" })
  const privacy = coreCases.find((c) => c.original_id === "core-privacy-cross")
  assert.equal(privacy.assertions.find((a) => a.type === "answerSentences" && a.privateName).privateName, "Kestrel")
  assert.equal(coreCases.find((c) => c.original_id === "core-durability").newSessionAfterRun, 1)
  assert.equal(coreCases.find((c) => c.original_id === "core-forget").newSessionAfterRun, 2)
  assert.equal(coreCases.find((c) => c.original_id === "core-wiki-write").newSessionAfterRun, 2)
  assert.ok(coreCases.every((c) => c.assertions.length && c.prompts.length))
})
