# config/

Sample config file for the proxy/TLS layer.

- **`figma-download.config.json.example`** — copy it to `figma-download.config.json`
  (next to where you run the tool) and it is picked up automatically, or point at
  it explicitly with `--config <path>`.

Recognized keys (both optional):

| key | type | default | meaning |
|---|---|---|---|
| `proxy` | string \| null | `null` | HTTP/HTTPS proxy URL (`null`/`""` = direct) |
| `sslVerify` | boolean | `true` | TLS certificate verification |

Precedence (highest wins): **CLI flag → config file → environment → default**.
The example disables TLS verification — only do that against a trusted
intercepting proxy. `--mock` is fully offline and ignores this file entirely.
