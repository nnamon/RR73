# QSP, the relay RR73 uses to receive from web SDRs (crates/rr73-qsp). Build from the repository root:
#   docker build -f docker/qsp.Dockerfile -t rr73-qsp .
# Run with a settings file mounted at /etc/qsp/qsp.toml, listening on 0.0.0.0:7373 inside:
#   docker run -d --name qsp --restart unless-stopped -p 127.0.0.1:7373:7373 -v /etc/qsp:/etc/qsp:ro rr73-qsp
FROM rust:1.98.1-slim-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock rust-toolchain.toml rustfmt.toml ./
COPY crates crates
RUN cargo build --release --locked -p rr73-qsp

FROM debian:bookworm-slim
RUN useradd --system --no-create-home qsp
COPY --from=build /src/target/release/rr73-qsp /usr/local/bin/rr73-qsp
USER qsp
EXPOSE 7373
ENTRYPOINT ["rr73-qsp", "--config", "/etc/qsp/qsp.toml"]
