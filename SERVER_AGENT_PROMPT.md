# Prompt for the server Agent

I run CLIProxyAPI on this server and need to expose provider quota information safely to a Pi/pi-web client. Install and configure the `pi-bridge` plugin from:

https://github.com/abix5/pi-cliproxyapi-bridge

Requirements and safety constraints:

1. First inspect the current CLIProxyAPI deployment, version, architecture, container paths, `config.yaml`, plugin support, reverse proxy, and how `MANAGEMENT_PASSWORD` is supplied. Do not print or copy secret values into chat or logs.
2. Back up `config.yaml` before editing it. Do not interrupt active model traffic unless a restart is truly required; prefer CLIProxyAPI's config hot reload.
3. Use the plugin registry installation path if compatible. Add the following store source without deleting existing plugin settings or store sources:

   `https://raw.githubusercontent.com/abix5/pi-cliproxyapi-bridge/main/registry.json`

4. Install a pinned released version of `pi-bridge` compatible with the running CLIProxyAPI plugin SDK and CPU architecture. Verify the release checksum. Do not blindly track `main` or build an unpinned binary.
5. Enable `pi-bridge`. Prefer this security configuration:

```yaml
plugins:
  enabled: true
  dir: "/CLIProxyAPI/plugins"
  store-sources:
    - https://raw.githubusercontent.com/abix5/pi-cliproxyapi-bridge/main/registry.json
  configs:
    pi-bridge:
      enabled: true
      priority: 3
      store:
        version: <PINNED_VERSION>
      allow_all_api_keys: false
      show_extra_analytics: false
```

Merge this with the existing YAML; do not replace unrelated configuration. If the actual plugin directory differs, preserve the deployment's real path.

6. Ensure the plugin can read the existing CPA management credential internally via the deployment's existing `MANAGEMENT_PASSWORD` mechanism or a protected secret file. Do not add the management password to Pi clients, browser code, plugin plaintext configuration, command output, or this conversation.
7. With `allow_all_api_keys: false`, authorize only the ordinary CLIProxyAPI API key currently used by my Pi provider (`MyCPA`). Use the management panel's masked-key checkbox mechanism. Never paste the raw key into `config.yaml`; the plugin should store only its masked/fingerprinted selection.
8. Keep the default server-side usage cache around 120 seconds unless the current provider constraints require a higher value. Do not configure aggressive upstream polling.
9. Verify from a trusted machine using the ordinary inference API key, without exposing it in process listings or shell history where possible:

```http
GET /v0/resource/plugins/pi-bridge/capabilities
GET /v0/resource/plugins/pi-bridge/usage
Authorization: Bearer <ordinary CLIProxyAPI API key>
X-Pi-Contract: 2
```

Acceptance criteria:

- Both endpoints are reachable through the same public origin used by Pi, including the reverse proxy.
- An authorized ordinary API key receives HTTP 200 and valid JSON.
- The usage response has `schemaVersion: 1`, an `accounts` array, and contract-v2 cache metadata when requested.
- An unknown or unauthorized API key receives HTTP 401.
- No endpoint is publicly readable without authentication.
- No management key, upstream OAuth token, auth file, raw API key, or Authorization header appears in logs or returned JSON.
- Account identifiers returned to the client are masked.
- Existing model inference continues to work.

10. If installation is incompatible, stop and report the exact CLIProxyAPI version, plugin SDK mismatch, architecture, and non-secret error. Do not force-load an incompatible `.so`.
11. At completion, report only: files changed, pinned plugin version, whether hot reload or restart was used, endpoint HTTP statuses, returned schema/contract versions, authorized masked key hint, cache TTL, and any remaining non-secret warning.
