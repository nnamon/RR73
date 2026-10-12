# rr73-kiwi, the KiwiSDR corpus recorder: Python 3.12, numpy, and the official KiwiSDR client
# (kiwiclient) fetched at a pinned commit when the image is built. kiwiclient is not kept in
# git. pytest and ruff are included for the tests and lint.
FROM python:3.12-slim

ARG KIWICLIENT_COMMIT=4eb733e6b6147f7fbeb97ced64cdac029b202d18
ADD --checksum=sha256:ffb6b2b4ab1caed7ff1b362cfa03bb1c169a55e46d8ba471addd4a20abc6137e \
    https://github.com/jks-prv/kiwiclient/archive/${KIWICLIENT_COMMIT}.tar.gz /tmp/kiwiclient.tar.gz
RUN mkdir -p /opt/kiwiclient \
 && tar -xzf /tmp/kiwiclient.tar.gz -C /opt/kiwiclient --strip-components=1 \
 && rm /tmp/kiwiclient.tar.gz \
 && echo "${KIWICLIENT_COMMIT}" > /opt/kiwiclient/COMMIT
RUN pip install --no-cache-dir numpy==2.2.6 pytest==8.3.5 ruff==0.12.0

# The recorder runs from the mounted workspace, like rr73-bench in the rust image.
ENV PYTHONPATH=/work/tools/kiwi:/opt/kiwiclient \
    PATH=/work/tools/kiwi/bin:${PATH} \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    RUFF_CACHE_DIR=/tmp/ruff-cache
WORKDIR /work
CMD ["record", "--help"]
