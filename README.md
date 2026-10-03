<div align="center">

# Pi Usage

Native OAuth and CLIProxyAPI quota windows, reset times, and local Skill usage counts for [Pi](https://github.com/earendil-works/pi-mono) and [pi-web](https://github.com/agegr/pi-web).

[中文文档](./README_zh.md) · [Report a bug](https://github.com/wayner6/pi-usage/issues)

</div>

## At a glance

Pi Usage adds a compact status item for the active model:

```text
Codex · 5h 92% (resets in 2h) · 7d 85% (resets in 5d 3h)
```

It also provides one command for detailed provider data and Skill statistics:

```text
/usage
/usage skills
```

The status follows supported active models. Native OAuth quotas are queried for OpenAI Codex, Anthropic, Kimi Code, and OpenRouter; CLIProxyAPI requires a compatible server plugin. Providers without a quota integration are omitted. Network errors, missing authentication, exhausted plans, and a real zero quota remain separate states.

## Screenshots

### Provider details with `/usage`

<table>
  <tr>
    <th>Pi terminal</th>
    <th>pi-web</th>
  </tr>
  <tr>
    <td><a href="https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/pi%E7%BB%88%E7%AB%AF%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA3.png"><img src="https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/pi%E7%BB%88%E7%AB%AF%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA3.png" alt="Pi terminal showing the /usage command" width="100%"></a></td>
    <td><a href="https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/Pi-web%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA3.png"><img src="https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/Pi-web%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA3.png" alt="pi-web showing the /usage command" width="100%"></a></td>
  </tr>
</table>

### Active model quota in the footer

<table>
  <tr>
    <th>Pi terminal</th>
    <th>pi-web</th>
  </tr>
  <tr>
    <td><a href="https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/pi%E7%BB%88%E7%AB%AF%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA1.png"><img src="https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/pi%E7%BB%88%E7%AB%AF%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA1.png" alt="Pi terminal showing the active model quota in the footer" width="100%"></a></td>
    <td><a href="https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/Pi-web%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA1.png"><img src="https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/Pi-web%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA1.png" alt="pi-web showing the active model quota in the footer" width="100%"></a></td>
  </tr>
</table>

Click an image to open the full-size version.

## Install

Choose npm or GitHub as the installation source. **The new OAuth and `pi-usage-cpa` support is on GitHub (`0.4.0`); npm currently serves the older `0.3.0`.**

### Pi terminal

```bash
# npm
pi install npm:@wayner6/pi-usage

# GitHub
pi install github:wayner6/pi-usage
```

### pi-web

Open **Settings > Plugins > Add Plugin**, choose the `global` scope, and enter one of these sources:

```text
npm:@wayner6/pi-usage
```

```text
git:https://github.com/wayner6/pi-usage
```

Reload the current session after installing or updating the plugin.

## Commands

Pi Usage registers only the `/usage` command.

| Command | What it does |
| --- | --- |
| `/usage` | Shows supported native OAuth and CLIProxyAPI providers |
| `/usage all` | Same as `/usage` |
| `/usage current` | Shows data for the active model's provider |
| `/usage refresh` | Bypasses the cache and refreshes the active provider |
| `/usage doctor` | Shows the active model, adapter, authentication state, and bridge diagnostics |
| `/usage skills` | Lists every installed Skill and its accumulated use count, including zero |
| `/usage settings` | Shows the current plugin settings and configuration path |

### Skill counting

Pi does not emit a dedicated `skill_invoked` event. Pi Usage detects a Skill activation when either of these happens:

1. An accepted `/skill:name` command enters an agent run (failed or cancelled submissions do not count).
2. The model successfully reads the entry file of a Skill discovered by Pi.

The same Skill is counted once per agent run, so a `/skill:name` command followed by a read of its `SKILL.md` adds one use, not two. Counts begin after Skill tracking is installed and enabled. Old sessions are not scanned.

`/usage skills` always includes every Skill currently discovered by Pi. Skills that have not been used show `0`.

## Provider support

| Provider | Level | Authentication | Displayed data |
| --- | --- | --- | --- |
| OpenAI Codex | Full quota | ChatGPT OAuth | Main 5-hour and 7-day windows; additional model limits when returned |
| Anthropic | OAuth usage endpoint (undocumented, may rate-limit) | Pi Claude Pro/Max OAuth | 5-hour, 7-day and returned model-specific weekly windows |
| Kimi Code | OAuth usage endpoint (undocumented) | Pi `kimi-coding` OAuth | 7-day and reported rolling 5-hour windows |
| OpenRouter | Key-level limits | Pi OpenRouter OAuth (exchanged for an API key) | Per-key spending cap and free-model daily requests if present; **not** account balance or subscription quota |
| CLIProxyAPI | Upstream-dependent | Proxy API key and server-side `pi-usage-cpa` or legacy `pi-bridge` | Only accounts and pools returned by the installed plugin |

Providers without a supported quota query are omitted from the status and provider listing. CPA may display quota pools for upstream services returned by its plugin; this is not a native integration with those services.

### How provider data is handled

Native OAuth credentials are resolved by Pi; requests stay on each provider's fixed official origin and never follow cross-origin redirects. ChatGPT OAuth is queried at the official ChatGPT origin. API keys are not used for the ChatGPT integration. The account ID comes from the resolved OAuth token, not a separate auth file. Additional model limits appear in `/usage`; the compact status stays focused on the main windows. Reset countdowns are shown only when the provider returns a reset timestamp.

For CLIProxyAPI, the client tries [`pi-usage-cpa`](https://github.com/wayner6/pi-usage-cpa) first, falling back to the legacy `pi-bridge` endpoint **only on 404**. The new plugin's real-world Antigravity windows and CPA deployment remain unverified; the old bridge's single pools must not be labeled 5h/7d. Pi Usage uses the normal proxy API key and never requests or stores the CLIProxyAPI Management Key. It displays only the accounts and quota pools returned by the server plugin.

Proxy accounts are matched by model family and model ID. An unrelated model cannot reuse another provider's quota. Shared pools stay shared: Pi Usage does not turn one Antigravity pool into fictional 5-hour and weekly windows.

## States you may see

| State | Meaning |
| --- | --- |
| `Unauthorized` | Pi could not resolve valid credentials, or the provider rejected them |
| `No Quota` | The endpoint returned no supported quota fields; this does not establish zero remaining |
| `Unsupported` | A supported proxy reports that the selected upstream model has no quota integration |
| `Bridge Not Found` | CLIProxyAPI is reachable, but neither usage plugin endpoint is available |
| `stale` | A refresh failed and the last successful result is being shown |
| `0%` | The provider successfully reported a real zero quota |

## Settings

```text
/usage settings status on|off       # compact status item, default: on
/usage settings widget on|off       # detailed widget below the editor, default: off
/usage settings skills on|off       # local Skill counting, default: on
/usage settings interval <seconds>  # automatic refresh, 30 to 3600, default: 120
/usage settings timeout <seconds>   # request timeout, 2 to 60, default: 10
```

Local files:

```text
~/.pi/agent/pi-usage/config.json
~/.pi/agent/pi-usage/skill-usage.jsonl
```

The Skill log is append-only and stores only the Skill name and timestamp.

## Update

```bash
# Update Pi Usage installed from npm
pi update npm:@wayner6/pi-usage

# Update all installed extensions without updating Pi itself
pi update --extensions
```

In pi-web, open **Settings > Plugins**, update Pi Usage, and reload the session.

## Privacy and security

Pi Usage does not use browser cookies, telemetry, or cloud synchronization. It does not send credentials to third-party origins. Native OAuth usage requests stay on their respective official origins, while CLIProxyAPI requests stay on the configured proxy origin.

Skill counting does not store prompts, conversation text, tool output, or Skill contents.

Security reports are covered by [SECURITY.md](./SECURITY.md).

## Development

```bash
npm install
npm run verify
npm run pack:check
```

`npm run verify` runs TypeScript checks and the test suite. See [CONTRIBUTING.md](./CONTRIBUTING.md) before submitting a change.

## Community

Thanks to the [LINUX DO](https://linux.do/) community for testing and discussion.

## License

[MIT](./LICENSE)
