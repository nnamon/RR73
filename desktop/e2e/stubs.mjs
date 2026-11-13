// Local stand-ins for the services the desktop app reaches, so the smoke tests never leave the
// machine: GitHub's latest release and an NTP server.

import { createServer } from 'node:http';
import { createSocket } from 'node:dgram';

/** Serves `GET /latest` as GitHub's latest release with tag `v${version}`; records each request's headers. */
export function releaseFeed(version) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url, accept: req.headers.accept });
    if (req.url !== '/latest') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ tag_name: `v${version}`, name: version, draft: false, prerelease: false, html_url: 'http://127.0.0.1/unused' }));
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/latest`, requests, close: () => server.close() })),
  );
}

/** Seconds from 1900 (NTP) to 1970 (Unix). */
const NTP_UNIX = 2_208_988_800n;

function ntpStamp(unixMs) {
  const ms = BigInt(Math.round(unixMs));
  const secs = ms / 1000n + NTP_UNIX;
  const frac = ((ms % 1000n) << 32n) / 1000n;
  return (secs << 32n) | frac;
}

/**
 * An SNTP server on 127.0.0.1 port 123 whose clock runs `aheadMs` ahead of this machine's.
 * Port 123 needs root, as in the container.
 */
export function ntpServer(aheadMs) {
  const socket = createSocket('udp4');
  let requests = 0;
  socket.on('message', (msg, from) => {
    if (msg.length < 48) return;
    requests++;
    const now = Date.now() + aheadMs;
    const reply = Buffer.alloc(48);
    reply[0] = 0x24; // leap 0, version 4, mode 4 (server)
    reply[1] = 2; // stratum
    msg.copy(reply, 24, 40, 48); // originate = the request's transmit time
    reply.writeBigUInt64BE(ntpStamp(now), 32); // receive
    reply.writeBigUInt64BE(ntpStamp(now), 40); // transmit
    socket.send(reply, from.port, from.address);
  });
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(123, '127.0.0.1', () => resolve({ requests: () => requests, close: () => socket.close() }));
  });
}
