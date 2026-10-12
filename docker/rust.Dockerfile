# Rust toolchain for the workspace, the bench and WebAssembly builds. Also builds ft8_lib
# for the codec oracle, so it carries a C toolchain.
FROM rust:1.98.1-slim-bookworm

ARG WASM_PACK_VERSION=0.15.0
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git make gcc libc6-dev pkg-config \
 && rm -rf /var/lib/apt/lists/*
RUN rustup component add rustfmt clippy && rustup target add wasm32-unknown-unknown
RUN arch="$(uname -m)" \
 && case "$arch" in aarch64) triple=aarch64-unknown-linux-musl ;; x86_64) triple=x86_64-unknown-linux-musl ;; *) echo "unsupported $arch"; exit 1 ;; esac \
 && curl -fsSL "https://github.com/rustwasm/wasm-pack/releases/download/v${WASM_PACK_VERSION}/wasm-pack-v${WASM_PACK_VERSION}-${triple}.tar.gz" \
    | tar -xz -C /usr/local/bin --strip-components=1 "wasm-pack-v${WASM_PACK_VERSION}-${triple}/wasm-pack" \
 && wasm-pack --version

ENV CARGO_TARGET_DIR=/work/target PATH="/work/tools/bin:${PATH}"
WORKDIR /work
