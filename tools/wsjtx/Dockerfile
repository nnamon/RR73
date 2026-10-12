# WSJT-X command-line tools (jt9, ft8sim) as the decoder reference, plus Python 3 for
# reference.py. The tools come from the Ubuntu 24.04 wsjtx package. The first stage installs
# the whole package; the final stage keeps the two binaries and the libraries they link, which
# saves about 300 MB of Qt GUI, Hamlib and multimedia dependencies.
ARG WSJTX_DEB_VERSION=2.7.0~rc3+repack-1build2

FROM ubuntu:24.04 AS package
ARG WSJTX_DEB_VERSION
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "wsjtx=${WSJTX_DEB_VERSION}" \
 && wsjtx_app_version -v | sed -n 's/^WSJT-X //p' > /wsjtx-version \
 && test -s /wsjtx-version

FROM ubuntu:24.04
ARG WSJTX_DEB_VERSION
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      libfftw3-single3 libgfortran5 libgomp1 libqt5core5t64 python3 python3-pytest \
 && rm -rf /var/lib/apt/lists/*
COPY --from=package /usr/bin/jt9 /usr/local/libexec/wsjtx/jt9
COPY --from=package /usr/bin/ft8sim /usr/local/bin/ft8sim
COPY jt9.sh /usr/local/bin/jt9
COPY --from=package /usr/share/doc/wsjtx/copyright /usr/share/doc/wsjtx/copyright
COPY --from=package /wsjtx-version /usr/local/share/wsjtx/version
RUN jt9 --help > /dev/null && ft8sim > /dev/null \
 && ! ldd /usr/local/libexec/wsjtx/jt9 /usr/local/bin/ft8sim | grep "not found"
LABEL org.opencontainers.image.description="WSJT-X ${WSJTX_DEB_VERSION} jt9 and ft8sim for RR73 reference decodes"
# reference.py runs from the mounted workspace, like rr73-bench in the rust image.
ENV PATH="/work/tools/wsjtx:${PATH}" PYTHONDONTWRITEBYTECODE=1
WORKDIR /work
