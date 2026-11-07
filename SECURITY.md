# Security

## Reporting

Report a vulnerability privately: open a GitHub security advisory on this repository, or email the
maintainer listed in `package.json`. Do not open a public issue for a vulnerability.

Please include what the tool does, what you expected, and the smallest case that shows it.

## Scope

This tool reads recordings, traces and plugin checkouts and writes results, labels and traces. It starts
OpenCode from a stock binary it is pointed at, and a mock model on loopback. It does not call a vendor's
API, does not sign in to anything, and holds no credentials.

The one thing worth knowing: a trace is derived from a real session, and the tool's privacy layer reduces
content to structure. If you find a trace that carries text, a handle, an id or a link from a vendor's
results, that is a vulnerability in this tool. `evals privacy --scan` is the check, and it must be clean
before any result is shared.

## Supported versions

The published package is supported on the OpenCode versions listed in the README.
