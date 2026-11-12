// The docs link to files that exist: a link to a page nobody wrote is a promise the repository does not keep.
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, dirname, resolve } from "node:path"

const ROOT = join(import.meta.dirname, "..")
const pages = [
  ...["README.md", "CONTRIBUTING.md", "SECURITY.md", "CHANGELOG.md"].map((file) => join(ROOT, file)),
  ...readdirSync(join(ROOT, "docs")).filter((file) => file.endsWith(".md")).map((file) => join(ROOT, "docs", file)),
].filter((file) => existsSync(file))

const anchorsOf = (text) =>
  new Set(
    text
      .split("\n")
      .filter((line) => /^#{1,6} /.test(line))
      .map((line) => line.replace(/^#+ /, "").trim().toLowerCase().replace(/[^\w\- ]/g, "").replace(/ /g, "-")),
  )

test("every relative link in the docs resolves, anchors included", () => {
  const broken = []
  for (const page of pages) {
    const text = readFileSync(page, "utf8")
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1]
      if (/^[a-z]+:/i.test(target)) continue
      const [file, anchor] = target.split("#")
      const path = file ? resolve(dirname(page), file) : page
      if (!existsSync(path)) {
        broken.push(`${page.slice(ROOT.length + 1)} -> ${target}`)
        continue
      }
      if (anchor && path.endsWith(".md") && !anchorsOf(readFileSync(path, "utf8")).has(anchor)) broken.push(`${page.slice(ROOT.length + 1)} -> ${target} (no such heading)`)
    }
  }
  assert.deepEqual(broken, [])
})

test("every docs page named in backticks exists", () => {
  const missing = []
  for (const page of pages) {
    for (const match of readFileSync(page, "utf8").matchAll(/`(docs\/[a-z0-9-]+\.md)`/g)) {
      if (!existsSync(join(ROOT, match[1]))) missing.push(`${page.slice(ROOT.length + 1)} names ${match[1]}`)
    }
  }
  assert.deepEqual(missing, [])
})
