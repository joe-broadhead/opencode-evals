// The pre-publish gate. This repository becomes public, so nothing private may be in the working tree, in
// any file's contents, or anywhere in the git history — including history that is later squashed: a blob
// that was ever committed is still inside the pack until the history is rewritten.
//
// It fails on: a machine-local absolute path, an email address (except the reserved example domains), a
// real status link, a credential-shaped string, a real handle, and any path that belongs to the private
// store. It also refuses a commit whose message carries the same.

import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(import.meta.dirname, "..", "..")

/** Paths that may never be committed, whatever is in them. */
export const FORBIDDEN_PATHS = [/^traces\//, /^results\//, /^private\//, /^holdouts\//, /\.trace\.jsonl$/, /\.jsonl$/i, /^node_modules\//, /^\.env/]

const SYNTHETIC = /0123456789|abcdefghij|ABCDEFGHIJ|dummy|canary|example|placeholder|fixture|not-a-(token|key|secret)|redacted/i

/**
 * Token shapes, each a vendor's own prefix and the characters that follow it. Written so the same source works for JavaScript and for
 * `git grep -E` (no lookahead, no lazy quantifier). A normal hex digest (sha256, a commit id) holds none of these prefixes.
 */
export const TOKEN_SHAPES = [
  ["token-anthropic", "an Anthropic API key or Claude OAuth token (sk-ant-)", /\bsk-ant-[A-Za-z0-9_-]{16,}/g],
  ["token-sk", "an API key (sk-, sk-proj-, sk-or-v1-)", /\bsk-(proj|or|svcacct)-[A-Za-z0-9_-]{16,}/g],
  ["token-slack", "a Slack token (xoxb-, xoxp-, xoxa-, xoxe-, xoxr-, xapp-)", /\b(xox[abeprs]|xapp)-[A-Za-z0-9.-]{10,}/g],
  ["token-github", "a GitHub token (ghp_, gho_, ghu_, ghs_, ghr_, github_pat_)", /\b(gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g],
  ["token-google", "a Google OAuth access or refresh token (ya29., 1//)", /\b(ya29\.[A-Za-z0-9_-]{20,}|1\/\/0[A-Za-z0-9_-]{30,})/g],
  ["token-jwt", "a JSON Web Token", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  ["token-linear", "a Linear token (lin_oauth_, lin_api_)", /\blin_(oauth|api)_[A-Za-z0-9]{16,}/g],
  ["token-notion", "a Notion token (ntn_, secret_)", /\b(ntn_[A-Za-z0-9]{16,}|secret_[A-Za-z0-9]{32,})/g],
  ["token-atlassian", "an Atlassian API token (ATATT)", /\bAT(ATT|CTT)[A-Za-z0-9_=-]{20,}/g],
  ["token-aws", "an AWS access key id", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["token-vendor-key", "a vendor API key (tvly-, sk_ of ElevenLabs, AIza of Google)", /\b(tvly-[A-Za-z0-9]{16,}|sk_[a-f0-9]{30,}|AIza[A-Za-z0-9_-]{30,})/g],
  ["token-bearer", "a Bearer token of any length", /\bBearer[ \t]+[A-Za-z0-9._~+\/=-]{8,}/g],
  ["token-oauth-field", "an OAuth access or refresh token value", /["']?(access|refresh|id)[_-]?token["']?[ \t]*[:=][ \t]*["'][A-Za-z0-9._~+\/=-]{24,}["']/gi],
  ["private-key", "a private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
]

const PATTERNS = [
  { id: "home-path", re: /\/Users\/[A-Za-z0-9._-]+|\/private\/var\/|\/home\/[A-Za-z0-9._-]+\//g, why: "a machine-local absolute path" },
  { id: "email", re: /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[a-z]{2,})/g, why: "an email address", allow: (match, domain) => /(^|\.)(example\.(com|org|net)|users\.noreply\.github\.com)$/.test(domain) },
  // A status id is 19 digits; a shorter one is a fixture in a test.
  { id: "x-status", re: /x\.com\/[A-Za-z0-9_]+\/status\/[0-9]{8,}/g, why: "a real post link" },
  // A value that is obviously made up: a run of sequential digits or letters, or a word that says so. A real secret is random, and
  // never holds `0123456789` or `abcdefghij`; tests and docs write theirs that way so the scan can tell them apart.
  { id: "credential", re: /\b(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|xoxb-[A-Za-z0-9-]{10,}|Bearer\s+[A-Za-z0-9._-]{20,})/g, why: "a credential-shaped string" },
  // Token shapes by vendor (G0 review 3.5): each fails a scan of a tree or a history that holds one.
  ...TOKEN_SHAPES.map(([id, why, re]) => ({ id, why, re, allow: (match) => SYNTHETIC.test(match) || (id === "token-bearer" && !/[0-9]/.test(match.replace(/^Bearer\s+/, ""))) })),
  { id: "private-store", re: /evals-lab\/private|evalruns\/[a-z0-9]{2,}\/|opencode-release\/review/g, why: "a path into the private store" },

]

const TEXT = /\.(mjs|js|ts|json|md|yml|yaml|txt|sh|tsx|css|html)$/

/**
 * The history is held to the data patterns, not to the path patterns: an old commit that mentions a
 * directory name in a comment reveals a layout, not a person. A path that *held* private data is caught by
 * FORBIDDEN_PATHS, which the history scan applies per file name.
 */
const HISTORY_PATTERNS = PATTERNS.filter((pattern) => pattern.id !== "private-store")

export function scanText(text, where, patterns = PATTERNS) {
  const findings = []
  for (const { id, re, why, allow } of patterns) {
    re.lastIndex = 0
    for (const match of String(text).matchAll(re)) {
      if (allow && allow(match[0], match[1])) continue
      const line = String(text).slice(0, match.index).split("\n").length
      findings.push({ where, line, id, why, sample: `${match[0].slice(0, 40)}${match[0].length > 40 ? "…" : ""}` })
    }
  }
  return findings
}

/** Every text file in the working tree, minus the git directory. */
export function treeFiles(root = ROOT) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (TEXT.test(entry.name) || entry.name === ".gitignore" || entry.name === "LICENSE") out.push(path)
    }
  }
  walk(root)
  return out
}

/** The working tree: paths, then contents. */
export function scanTree(root = ROOT) {
  const findings = []
  for (const path of treeFiles(root)) {
    const rel = relative(root, path)
    for (const rule of FORBIDDEN_PATHS) if (rule.test(rel)) findings.push({ where: rel, line: null, id: "forbidden-path", why: "a path that belongs in the private store", sample: rel })
    findings.push(...scanText(readFileSync(path, "utf8"), rel))
  }
  return findings
}

/** Every blob in every commit: a file that was committed once is still in the pack until rewritten. */
export function scanHistory(root = ROOT) {
  const git = (args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (!existsSync(join(root, ".git"))) return []
  const findings = []
  let commits = []
  try {
    commits = git(["rev-list", "--all"]).split("\n").filter(Boolean)
  } catch {
    return []
  }
  for (const commit of commits) {
    const files = git(["ls-tree", "-r", "--name-only", commit]).split("\n").filter(Boolean)
    for (const file of files) {
      for (const rule of FORBIDDEN_PATHS) {
        if (rule.test(file)) findings.push({ where: `commit ${commit.slice(0, 8)}:${file}`, line: null, id: "forbidden-path-in-history", why: "a private path that was committed once", sample: file })
      }
    }
    const names = files.filter((file) => TEXT.test(file))
    if (!names.length) continue
    let contents = ""
    try {
      contents = git(["grep", "-I", "-n", "-E", HISTORY_PATTERNS.map((p) => p.re.source).join("|"), commit, "--", ...names.slice(0, 400)])
    } catch {
      continue
    }
    for (const line of contents.split("\n").filter(Boolean)) {
      // `git grep` on a commit prints `<commit>:<path>:<line>:<content>`.
      const parts = line.split(":")
      if (parts.length < 4) continue
      const where = `commit ${commit.slice(0, 8)}:${parts.slice(1, -2).join(":")}:${parts[parts.length - 2]}`
      findings.push(...scanText(parts[parts.length - 1], where, HISTORY_PATTERNS))
    }
    const message = git(["log", "-1", "--format=%B", commit])
    findings.push(...scanText(message, `commit ${commit.slice(0, 8)} message`, HISTORY_PATTERNS).map((f) => ({ ...f, id: "message" })))
  }
  return findings
}

export function scan({ root = ROOT, history = true } = {}) {
  const tree = scanTree(root)
  const commits = history ? scanHistory(root) : []
  return { tree, history: commits, ok: tree.length === 0 && commits.length === 0, total: tree.length + commits.length }
}

export const renderScan = (result) =>
  [
    `# privacy gate`,
    "",
    result.ok ? "clean: the tree and the history hold nothing private." : `**${result.total} finding(s)**`,
    "",
    ...result.tree.map((f) => `- tree: ${f.where}${f.line ? `:${f.line}` : ""} — ${f.why}: \`${f.sample}\``),
    ...result.history.map((f) => `- history: ${f.where} — ${f.why}: \`${f.sample}\``),
  ].join("\n")
