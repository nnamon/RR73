# 0004. Worker messaging without shared memory

Status: accepted, 2026-10-13

## Context

SharedArrayBuffer needs cross-origin isolation headers, which GitHub Pages can't send. A service-worker workaround exists but reloads the page on first visit and constrains every cross-origin request.

## Decision

Workers receive copies of slot audio (about 720 KB per FT8 slot) through `postMessage` with transferable buffers. Parallel decoding splits candidates across workers.

## Consequences

- GitHub Pages serves the app with no extra headers. Revisit only if the bench on an iPhone shows a measurable gain from shared memory.
