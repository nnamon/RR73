# minimodem, the reference RTTY decoder for the RTTY bench. The binary comes from the Ubuntu
# 24.04 package and is only run, never linked or copied. jq reads the bench's sidecar files.
FROM ubuntu:24.04
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends minimodem jq \
 && rm -rf /var/lib/apt/lists/* \
 && minimodem --version
ENV PATH="/work/tools/minimodem:${PATH}"
WORKDIR /work
