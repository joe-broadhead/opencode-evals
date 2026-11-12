# The image every `evals run --isolation container` trial runs in, and the batch's egress proxy runs in.
#
# Tools only: no OpenCode, no claude, no plugin, no credential and no configuration of the machine that builds it.
# The binaries under test are mounted read-only per batch (so `--host <version>` needs no image per version), and the
# credential reaches a trial's processes through `docker exec -e NAME` only, never through the image or `docker run`.
#
# Build it with `evals isolation build` (the tag is a digest of this directory, so an edit makes a new image), and
# check it with `evals isolation check`. The base is pinned by digest and every package by its Ubuntu 24.04 version
# (noble and noble-updates as of 2026-11-11). Ubuntu removes a superseded version from its archive, so when a build
# fails with "Version ... was not found", move that pin to the version `apt-cache policy <package>` offers.
#
# There is no Node in the image: Ubuntu's nodejs is 18.x, past its end of life, and nothing in a trial needs it (OpenCode
# and claude are standalone binaries). The egress proxy runs on the harness's own Node (>= 22), mounted read-only into
# the proxy's container only, with its sha256 recorded; libstdc++6 and libgcc-s1 are what that binary links against.
FROM ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852

RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates=20260816ubuntu0.24.04.2 \
      curl=8.5.0-2ubuntu10.16 \
      git=1:2.43.0-1ubuntu7.4 \
      jq=1.7.1-3ubuntu0.24.04.2 \
      procps=2:4.0.4-4ubuntu3.3 \
      ripgrep=14.1.0-1 \
      sqlite3=3.45.1-1ubuntu2.9 \
      tini=0.19.0-1 \
      libstdc++6=14.2.0-4ubuntu2~24.04.1 \
      libgcc-s1=14.2.0-4ubuntu2~24.04.1 \
 && rm -rf /var/lib/apt/lists/* \
 && install -d -m 0755 /opt/evals /opt/evals/bin

# The CONNECT-only egress proxy (docker/egress-proxy.mjs); trials never run it.
COPY --chmod=0444 egress-proxy.mjs /opt/evals/egress-proxy.mjs

USER 1000:1000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sleep", "infinity"]
