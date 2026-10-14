# rr73-qsp

QSP relays a web SDR's audio to RR73, which cannot open a KiwiSDR's plain `ws://` connection from its https page. It is optional: RR73 works without one, and anyone can run their own. Reports to PSK Reporter and uploads to WSPRnet follow. The design is in `docs/design/qsp.md`.

QSP carries no credentials for other services and reaches only the receivers its settings list.

## Running it

QSP speaks plain HTTP behind an HTTPS front, such as Caddy, which strips the path of the API base. The address RR73 needs is that API base, such as `https://dmr.pwn.sg/qsp`.

```sh
docker build -f docker/qsp.Dockerfile -t rr73-qsp .
sudo mkdir -p /etc/qsp && sudo cp crates/rr73-qsp/qsp.example.toml /etc/qsp/qsp.toml   # then edit it
docker run -d --name qsp --restart unless-stopped -p 127.0.0.1:7373:7373 -v /etc/qsp:/etc/qsp:ro rr73-qsp
```

In the container, set `listen = "0.0.0.0:7373"`; the `-p 127.0.0.1:7373:7373` keeps the port off the internet. Then in Caddy:

```
dmr.pwn.sg {
    handle_path /qsp/* {
        reverse_proxy 127.0.0.1:7373
    }
}
```

Caddy passes WebSockets through as they are. If the site already sits in a `handle` block, the `/qsp/*` block goes first.

Check it: `curl https://dmr.pwn.sg/qsp/about`. The API is described at `/docs`, and the OpenAPI document is at `/openapi.json`.

## Settings

`qsp.example.toml` lists every field. In short:

- `access_keys`: keys RR73 sends as `Authorization: Bearer <key>`, at least 16 characters; `openssl rand -hex 24` makes one. Empty: anyone may use the instance, still only for the receivers listed.
- `allowed_origins`: the sites a browser may call QSP from. RR73's is `https://nnamon.github.io`.
- `[[sdr.receivers]]`: each receiver offered, with `free_channels` (QSP does not connect when fewer would remain for other listeners) and `max_sessions`.
- `user_receivers`: whether users may name receivers of their own.

Log detail: `RUST_LOG=debug`. QSP logs no request bodies.

## Receivers

QSP connects to a receiver when the app opens a stream, after reading its `/status` page, and closes when the app stops. It sends `SET keepalive` every 5 s, takes audio only (no waterfall) at 12 kHz, and shows the listener as "<callsign> via RR73". Respect each receiver's own rules, and its owner's wishes.
