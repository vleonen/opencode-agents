# Verification image for the opencode-agents plugin.
#
# Installs BOTH opencode runtimes from the official installers (nothing is
# copied from the host):
#   opencode-v1 -> pinned V1 CLI (server loader, `web` subcommand)
#   opencode-v2 -> pinned V2 CLI (serve --service, plugin ctx API)
#
# The plugin itself is NOT baked in; docker/compose.yaml mounts the bundle and
# a global config read-only, so a rebuild is never needed while iterating.
FROM ubuntu:24.04 AS base

ARG DEBIAN_FRONTEND=noninteractive
ARG OPENCODE_V1_VERSION=1.18.31
ARG OPENCODE_V2_VERSION=2.0.16

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
         bash ca-certificates curl tar gzip git tzdata procps xdg-utils \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://opencode.ai/install \
      | bash -s -- --version "${OPENCODE_V1_VERSION}" --no-modify-path \
    && mv /root/.opencode/bin/opencode /usr/local/bin/opencode-v1

RUN curl -fsSL https://opencode.ai/v2/install \
      | bash -s -- --version "${OPENCODE_V2_VERSION}" --no-modify-path \
    && mv /root/.opencode/bin/opencode /usr/local/bin/opencode-v2 \
    && rm -rf /root/.opencode

RUN opencode-v1 --version && opencode-v2 --version

WORKDIR /workspace
