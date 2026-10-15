# rr73-qsp

QSP is the relay server for RR73. It handles the services a web page on an iPhone cannot reach directly. It carries web SDR receive, since KiwiSDRs serve only plain `ws://`, which Safari blocks from the https app, and reports to PSK Reporter, which take UDP. The design is in `docs/design/qsp.md`.

RR73 works without a relay, and anyone can run one. QSP never receives credentials for other services, and it connects only to the receivers its settings list.

## Running it

QSP serves plain HTTP behind an HTTPS front, such as Caddy, which strips the API base's path. Operators enter the API base in RR73, such as `https://relay.example.org/qsp`.

QSP is released with the app, at the app's version. Each release on GitHub carries `rr73-qsp-<version>-linux-x86_64.tar.gz` and `rr73-qsp-<version>-linux-aarch64.tar.gz`, each holding the binary, `qsp.example.toml`, `qsp.service` and this file, and publishes the image `ghcr.io/nnamon/rr73-qsp:<version>` (also `:latest`) for both architectures.

```sh
sudo mkdir -p /etc/qsp && sudo cp qsp.example.toml /etc/qsp/qsp.toml   # then edit it
docker run -d --name qsp --restart unless-stopped -p 127.0.0.1:7373:7373 -v /etc/qsp:/etc/qsp:ro ghcr.io/nnamon/rr73-qsp:latest
```

In the container, set `listen = "0.0.0.0:7373"`; the `-p 127.0.0.1:7373:7373` keeps the port off the internet. `docker/qsp.Dockerfile` builds the same image from source: `docker build -f docker/qsp.Dockerfile -t rr73-qsp .` from the repository root.

### Without Docker

On a small server, run the release's binary under systemd with its `qsp.service`. To build it from source for an x86-64 server on an Apple silicon Mac:

```sh
docker build --platform linux/amd64 -f docker/qsp.Dockerfile --target build -t rr73-qsp-build .
docker cp "$(docker create rr73-qsp-build)":/src/target/release/rr73-qsp .
```

On the server, as root, from the unpacked release:

```sh
useradd --system --no-create-home --shell /usr/sbin/nologin qsp
install -m 0755 rr73-qsp /usr/local/bin/rr73-qsp
install -d -m 0750 -o root -g qsp /etc/qsp
install -m 0640 -o root -g qsp qsp.toml /etc/qsp/qsp.toml
install -m 0644 qsp.service /etc/systemd/system/qsp.service
systemctl daemon-reload && systemctl enable --now qsp
```

Keep `listen = "127.0.0.1:7373"`. The unit limits QSP to half a CPU and 256 MB, and `journalctl -u qsp` shows its log.

### Caddy

```
relay.example.org {
    handle_path /qsp/* {
        reverse_proxy 127.0.0.1:7373
    }
}
```

Caddy proxies WebSockets without extra settings. If the site already ends in a catch-all `reverse_proxy`, wrap that in a `handle` block after the `/qsp/*` block.

Check it with `curl https://relay.example.org/qsp/about`. The API reference is at `/docs`, and the OpenAPI document at `/openapi.json`.

## Settings

`qsp.example.toml` lists every field. In short:

- `access_keys`: keys RR73 sends as `Authorization: Bearer <key>`, at least 16 characters; `openssl rand -hex 24` makes one. Empty: anyone may use the instance, still only for the receivers listed.
- `allowed_origins`: the sites a browser may call QSP from. RR73's is `https://nnamon.github.io`.
- `[[sdr.receivers]]`: each receiver offered, with `free_channels` (QSP does not connect when fewer would remain for other listeners) and `max_sessions`, the connections QSP may hold on the receiver at once: sessions on the same dial share one. QSP connects to these receivers and no others.
- `[pskreporter]`: `enabled` reports the app's decodes to PSK Reporter over UDP, by its developer page's rules. `test = true` marks every record as a test.

Log detail: `RUST_LOG=debug`. QSP logs no request bodies.

## Receivers

QSP reads a receiver's `/status` page and connects when the app opens a stream. Sessions on the same receiver and dial share one connection, and a retune moves a session to the connection for its new dial. QSP disconnects when the last session there stops. It sends `SET keepalive` every 5 s, takes audio at 12 kHz without the waterfall, shows the listener as "<callsign> via RR73", and names itself `RR73-QSP/<version> (+https://github.com/nnamon/RR73)` in its requests.

A connection that streamed and then dropped is opened again after 2, 4, 8, 16 and 30 s; the count starts over once it streams. QSP does not reconnect after the receiver refuses it, reports itself full, or closes it after a notice such as its time limit. Follow each receiver's published rules and its owner's requests.
