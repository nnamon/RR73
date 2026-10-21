# Builds the desktop app (desktop/, Tauri 2) for Linux: the Rust toolchain, Node for the Tauri
# command line and the web build, and the GTK and WebKitGTK headers Tauri links against.
FROM node:24-slim AS node

FROM rust:1.98.1-slim-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git file xdg-utils pkg-config gcc libc6-dev make \
      libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev libudev-dev libssl-dev patchelf \
 && rm -rf /var/lib/apt/lists/*
RUN rustup component add rustfmt clippy && rustup target add wasm32-unknown-unknown
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && node --version && npm --version
# The AppImage tools run without FUSE inside a container.
ENV CARGO_TARGET_DIR=/work/target/desktop APPIMAGE_EXTRACT_AND_RUN=1
WORKDIR /work
