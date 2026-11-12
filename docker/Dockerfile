# The image every `evals run --isolation container` trial runs in, and the batch's egress proxy runs in.
#
# Tools only: no OpenCode, no claude, no plugin, no credential and no configuration of the machine that builds it.
# The binaries under test are mounted read-only per batch (so `--host <version>` needs no image per version), and the
# credential reaches a trial's processes through `docker exec -e NAME` only, never through the image or `docker run`.
#
# Build it with `evals isolation build` (the tag is a digest of this directory, so an edit makes a new image), and
# check it with `evals isolation check`. The base is pinned by digest; the packages are Ubuntu 24.04's.
FROM ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852

RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates curl git ripgrep sqlite3 jq tini procps nodejs \
 && rm -rf /var/lib/apt/lists/* \
 && install -d -m 0755 /opt/evals /opt/evals/bin

# The CONNECT-only egress proxy (docker/egress-proxy.mjs); trials never run it.
COPY --chmod=0444 egress-proxy.mjs /opt/evals/egress-proxy.mjs

USER 1000:1000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sleep", "infinity"]
