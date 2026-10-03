<div align="center">

# Pi Usage

Remaining quota, reset times, and local Skill usage counts for the active model in [Pi](https://github.com/earendil-works/pi-mono) and [pi-web](https://github.com/agegr/pi-web).

[中文](./README.md) · [Install](#install) · [Usage](#usage) · [Report a bug](https://github.com/wayner6/pi-usage/issues)

</div>

## Features

- Display the active model's quota in the footer and follow model changes.
- Inspect provider, account, and quota-window details with `/usage`.
- List accumulated use counts for every installed Skill with `/usage skills`, including unused Skills.

Example footer:

```text
Codex · 5h 92% (resets in 2h) · 7d 85% (resets in 5d 3h)
```

Install Pi Usage in Pi / pi-web. Native OAuth connections query the provider directly. CLIProxyAPI (CPA) connections also need a plugin on the CPA server.

| Connection | Required installation |
| --- | --- |
| Pi native OAuth | This project |
| CPA API key | This project + server-side [pi-usage-cpa](https://github.com/wayner6/pi-usage-cpa#安装) |

## Install

Install from GitHub. The current version is **0.6.1**.

### pi-web

1. Open **Settings → Plugins → Add Plugin**.
2. Choose the `global` scope and enter:

   ```text
   git:https://github.com/wayner6/pi-usage
   ```

3. Install, then reload the current session.

### Pi terminal

```bash
pi install github:wayner6/pi-usage
```

Reload the current session after installation.

### Additional steps for CPA

1. Install **v0.2.3 or later** on the CPA server using the [pi-usage-cpa installation guide](https://github.com/wayner6/pi-usage-cpa#安装).
2. Keep your existing CPA model configuration and normal API key in Pi / pi-web. The management key belongs only on the server.
3. Select a CPA model and run `/usage doctor`. The adapter should be `pi-usage-cpa`. Use `/usage current` to check its quota.

Native OAuth users do not need the server plugin.

## Usage

Select a configured, supported model and run:

```text
/usage current
```

The compact footer is enabled by default. To show a detailed widget below the editor:

```text
/usage settings widget on
```

### Commands

| Command | Purpose |
| --- | --- |
| `/usage` or `/usage all` | Show all supported configured providers |
| `/usage current` | Show the active model's provider |
| `/usage refresh` | Bypass the client cache and refresh the active provider; server rate limits still apply |
| `/usage doctor` | Inspect the active model, adapter, and authentication state |
| `/usage skills` | List use counts for every installed Skill |
| `/usage settings` | Show settings and local file paths |

### How Skills are counted

A use is recorded when an accepted `/skill:name` command enters an agent run, or the model successfully reads the entry file of a Skill discovered by Pi. Each Skill is counted once per agent run. Failed or cancelled commands and failed reads do not count.

Counting begins after installation with tracking enabled. Old sessions are not scanned. The log stores only Skill names and timestamps, not conversations or file contents.

### Screenshots

<details>
<summary>View Pi terminal and pi-web screenshots</summary>

| | Pi terminal | pi-web |
| --- | --- | --- |
| `/usage` details | [![Pi terminal provider details][pi-details]][pi-details] | [![pi-web provider details][web-details]][web-details] |
| Footer | [![Pi terminal footer][pi-status]][pi-status] | [![pi-web footer][web-status]][web-status] |

Click an image to open the full-size version.

</details>

[pi-details]: https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/pi%E7%BB%88%E7%AB%AF%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA3.png
[web-details]: https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/Pi-web%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA3.png
[pi-status]: https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/pi%E7%BB%88%E7%AB%AF%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA1.png
[web-status]: https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/Pi-web%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA1.png

## Supported providers

### Native OAuth

Uses the OAuth credentials resolved by Pi. No separate quota-query key is needed.

| Provider | Available data |
| --- | --- |
| OpenAI Codex | Main 5h and 7d windows, plus additional model quotas returned by the API |
| Anthropic | 5h, 7d, and model-specific weekly quotas; undocumented endpoint that may rate-limit |
| Kimi Code | 7d and reported rolling 5h quota; undocumented endpoint |
| OpenRouter | Per-key spending cap and free-model daily request quota when present, not account balance |

### Through CPA

Displays quotas returned by the server plugin for Antigravity, Claude, Codex, Kimi, xAI, Devin, and Meta. See the [server support table](https://github.com/wayner6/pi-usage-cpa#支持的服务商) for each provider's data scope.

Antigravity's shared quota matches Claude and GPT-OSS. Other GPT models match Codex. If multiple accounts match and the actual routing account is unknown, the footer shows `N accounts · routing account unknown` without selecting one or merging their quotas.

Quota and reset times come from upstream data. An unknown window stays `window unknown`; reset times and balances are not used to infer 5h / 7d. Providers without a queryable quota do not get a quota display.

## Settings and updates

```text
/usage settings status on|off       # compact footer, default: on
/usage settings widget on|off       # detailed widget, default: off
/usage settings skills on|off       # Skill counting, default: on
/usage settings interval <seconds>  # automatic refresh: 30–3600 seconds, default: 120
/usage settings timeout <seconds>   # request timeout: 2–60 seconds, default: 10
```

Local configuration and count log:

```text
~/.pi/agent/pi-usage/config.json
~/.pi/agent/pi-usage/skill-usage.jsonl
```

In pi-web, update Pi Usage under **Settings → Plugins**. In the terminal, update all extensions without updating Pi itself:

```bash
pi update --extensions
```

Reload the session after updating.

## Troubleshooting

Start with `/usage doctor` to confirm the active model, adapter, and authentication state.

| Display | Meaning and next step |
| --- | --- |
| `Unauthorized` | Credentials are missing or rejected; check OAuth login or the normal CPA API key |
| `Bridge Not Found` | The CPA plugin endpoint is unavailable; check server registration and activation. The client does not fall back to `pi-bridge` |
| `No Quota` / `unavailable` | No recognized or matching quota was returned; this does not mean zero balance |
| `window unknown` | A quota fraction exists, but upstream did not identify its window |
| `routing account unknown` | Multiple accounts match, and the actual routing account is unknown |
| `stale` | The refresh failed; the last successful result is retained |
| `0%` | Upstream reported a real zero remaining quota |

For CPA, a provider marked `[ok]` means the plugin response was readable. Individual accounts can still report quota-query errors; check their details in `/usage`.

## Privacy and security

Native OAuth quota requests use fixed official provider origins, and authenticated requests do not follow cross-origin redirects. CPA requests use only the configured proxy origin and normal API key. The client never requests or stores the CPA management key.

No browser cookies, telemetry, or cloud synchronization. Skill counting does not store prompts, conversations, tool output, or Skill contents. See [SECURITY.md](./SECURITY.md) for security reports.

## Development

```bash
npm install
npm run verify
npm run pack:check
```

`verify` runs TypeScript checks and tests; `pack:check` checks package contents. See [CONTRIBUTING.md](./CONTRIBUTING.md).

Thanks to the [LINUX DO](https://linux.do/) community for testing and discussion.

## License

[MIT](./LICENSE)
