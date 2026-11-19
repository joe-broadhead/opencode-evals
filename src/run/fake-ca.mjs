// The throwaway CA of fake mode. A fake-mode plugin runs on its DEFAULT vendor URL (https://mcp.atlassian.com/..., https://api.githubcopilot.com/...), so the
// plugin sees no conflict and runs exactly as released; the trial maps that host name to the fake server on loopback (`--add-host`), keeps it off the egress
// proxy (NO_PROXY), and the fake answers TLS with a certificate this CA signed. The CA is made for one batch and exists only inside it:
//   - it is generated here with `openssl`, with a NAME CONSTRAINT (it may sign only the fake hosts, so even inside a trial it can vouch for nothing else);
//   - its private key is deleted as soon as the leaf certificates are signed (nothing can sign another);
//   - its certificate reaches a trial only as that trial's NODE_EXTRA_CA_CERTS, the runtime's own way to add a CA; it is never added to the machine's trust
//     store, the container image, or any file outside the batch's directory, and it goes with the batch directory.
import { execFileSync } from "node:child_process"
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const run = (args, cwd) => execFileSync("openssl", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })

/**
 * Writes `<dir>/ca.pem` and, per host, `<dir>/<id>.key` and `<dir>/<id>.pem` (a leaf for that host name alone).
 * `hosts` is `{ <id>: <host name> }`. Returns `{ ca, leaves: { <id>: { key, cert } } }`.
 */
export function makeFakeCa(dir, hosts, { days = 2 } = {}) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const names = Object.values(hosts)
  if (!names.length) throw new Error("makeFakeCa: no host")
  for (const host of names) if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host)) throw new Error(`makeFakeCa: ${JSON.stringify(host)} is not a host name`)
  const caKey = join(dir, "ca.key")
  writeFileSync(join(dir, "ca.cnf"), `[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=evals fake-mode CA (one batch)\n[v3]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign\nnameConstraints=critical,permitted;${names.map((h) => `DNS:${h}`).join(",permitted;")}\nsubjectKeyIdentifier=hash\n`)
  run(["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", caKey, "-out", join(dir, "ca.pem"), "-days", String(days), "-config", join(dir, "ca.cnf")], dir)
  const leaves = {}
  try {
    for (const [id, host] of Object.entries(hosts)) {
      const key = join(dir, `${id}.key`)
      const csr = join(dir, `${id}.csr`)
      const cert = join(dir, `${id}.pem`)
      writeFileSync(join(dir, `${id}.cnf`), `[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=${host}\n[ext]\nsubjectAltName=DNS:${host}\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n`)
      run(["req", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", key, "-out", csr, "-config", join(dir, `${id}.cnf`)], dir)
      run(["x509", "-req", "-in", csr, "-CA", join(dir, "ca.pem"), "-CAkey", caKey, "-CAcreateserial", "-out", cert, "-days", String(days), "-extfile", join(dir, `${id}.cnf`), "-extensions", "ext"], dir)
      // The trial's uid is the caller's, so its own copies are readable by it and by nothing outside the batch.
      chmodSync(key, 0o444)
      chmodSync(cert, 0o444)
      leaves[id] = { key, cert }
    }
  } finally {
    // Nothing can sign another certificate once the leaves exist.
    rmSync(caKey, { force: true })
  }
  chmodSync(join(dir, "ca.pem"), 0o444)
  return { ca: join(dir, "ca.pem"), leaves }
}
