# rr73-qsp

QSP is the relay server for RR73. It handles the services a web page on an iPhone cannot reach directly. It carries web SDR receive, since KiwiSDRs serve only plain `ws://`, which Safari blocks from the https app, and reports to PSK Reporter, which take UDP. The design is in `docs/design/qsp.md`.

RR73 works without a relay, and anyone can run one. QSP never receives credentials for other services, and it connects only to the receivers its settings list.

## Running it

QSP serves plain HTTP behind an HTTPS front, such as Caddy, which strips the API base's path. Operators enter the API base in RR73, such as `https://relay.example.org/qsp`.

```sh
docker build -f docker/qsp.Dockerfile -t rr73-qsp .
sudo mkdir -p /etc/qsp && sudo cp crates/rr73-qsp/qsp.example.toml /etc/qsp/qsp.toml   # then edit it
docker run -d --name qsp --restart unless-stopped -p 127.0.0.1:7373:7373 -v /etc/qsp:/etc/qsp:ro rr73-qsp
```

In the container, set `listen = "0.0.0.0:7373"`; the `-p 127.0.0.1:7373:7373` keeps the port off the internet.

### Without Docker

On a small server, run the binary under systemd with `qsp.service` from this directory. Build it for the server's architecture; from an Apple silicon Mac, for an x86-64 server:

```sh
docker build --platform linux/amd64 -f docker/qsp.Dockerfile --target build -t rr73-qsp-build .
docker cp "$(docker create rr73-qsp-build)":/src/target/release/rr73-qsp .
```

On the server, as root:

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
- `[[sdr.receivers]]`: each receiver offered, with `free_channels` (QSP does not connect when fewer would remain for other listeners) and `max_sessions`.
- `user_receivers`: whether users may name receivers of their own.
- `[pskreporter]`: `enabled` reports the app's decodes to PSK Reporter over UDP, by its developer page's rules. `test = true` marks every record as a test.

Log detail: `RUST_LOG=debug`. QSP logs no request bodies.

## Receivers

QSP reads a receiver's `/status` page and connects when the app opens a stream. It disconnects when the app stops. It sends `SET keepalive` every 5 s, takes audio at 12 kHz without the waterfall, and shows the listener as "<callsign> via RR73". Follow each receiver's published rules and its owner's requests.
