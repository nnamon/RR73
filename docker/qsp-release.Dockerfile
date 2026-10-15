# The QSP image each release publishes as ghcr.io/nnamon/rr73-qsp:<version> and :latest, for x86-64
# and ARM64 Linux. It holds the release's own binaries, built by CI (.github/workflows/ci.yml, QSP
# release); the build context is the folder holding rr73-qsp-amd64 and rr73-qsp-arm64.
# docker/qsp.Dockerfile builds the same program from source.
FROM debian:bookworm-slim
ARG TARGETARCH
COPY --chmod=0755 rr73-qsp-${TARGETARCH} /usr/local/bin/rr73-qsp
# nobody: QSP needs no account of its own in the container.
USER 65534:65534
EXPOSE 7373
ENTRYPOINT ["rr73-qsp", "--config", "/etc/qsp/qsp.toml"]
