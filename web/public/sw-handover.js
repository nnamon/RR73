// Imported by the generated service worker (vite.config.ts, workbox.importScripts).
//
// A new version installs and waits until the app sends SKIP_WAITING at a safe moment, so the
// running build keeps every file it may still load. Builds up to 0.5.0 never send it: they
// expect a new version to take over at once and reload themselves at the next change of screen.
// So at install this worker asks the active one whether it knows the handover. Workers from
// those builds do not answer, and this one then takes over at once, as they expect.

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'RR73_HANDOVER' && event.ports[0]) event.ports[0].postMessage('waits');
});

self.addEventListener('install', (event) => {
  const active = self.registration.active;
  // The first install takes over without waiting anyway.
  if (!active) return;
  event.waitUntil(
    new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(false), 3000);
      channel.port1.onmessage = () => {
        clearTimeout(timer);
        resolve(true);
      };
      active.postMessage({ type: 'RR73_HANDOVER' }, [channel.port2]);
    }).then((answered) => (answered ? undefined : self.skipWaiting())),
  );
});
