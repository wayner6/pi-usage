# Pi Usage

[中文文档](./README_zh.md)

Pi Usage is a [Pi](https://github.com/earendil-works/pi-mono) and [pi-web](https://github.com/agegr/pi-web) plugin that shows the balance or quota of the provider behind the active model.

## What it shows

- A compact status line for the active model, such as `Codex · 5h 92% (resets in 2h) · 7d 85% (resets in 5d 3h)`.
- Remaining balance, quota/rate-limit windows, and reset times when the provider exposes them.
- Details for configured providers through `/usage`, including unavailable or unsupported states.

The display follows the active model. Quota windows include reset countdowns when the provider supplies reset timestamps. Request failures are never converted into zero balance.

## Provider support

| Provider | Support level | Authentication | What is displayed |
| --- | --- | --- | --- |
| OpenAI Codex | Quota | ChatGPT Plus/Pro OAuth | 5-hour and 7-day remaining quota with reset countdowns |
| Anthropic Claude | Quota / limited | Claude OAuth or API key | OAuth: 5-hour and 7-day subscription quota; API key: request/token rate-limit headroom only |
| DeepSeek | Balance | API key | Official account balances by currency |
| GLM / Zhipu BigModel | Quota / limited | API key | Coding Plan: 5-hour and 7-day quota; standard pay-as-you-go keys: no official balance/quota query |
| OpenRouter | Balance | OAuth-resolved key or API key | Account balance, or key remaining limit, plus total usage |
| OpenCode Go | Quota | API key | Rolling 5-hour, weekly, and monthly windows; the footer shows 5-hour and weekly, `/usage` shows all windows |
| Kimi Code | Quota / status | Kimi OAuth or Kimi Code API key | Active plan: 5-hour and weekly quota; no active plan or exhausted credits: `No active quota` |
| CLIProxyAPI | Upstream-dependent | Proxy API key plus server-side `pi-bridge` | Only the accounts and quota pools actually returned by `pi-bridge` |
| xAI / Grok | Status only | OAuth | Account identity and active/spending-limit status; no numerical subscription quota |
| Google Vertex AI | Unsupported | API key, ADC, or service account | Explicit `Unsupported`; no single subscription-style quota exists |
| Google Gemini API / AI Studio | Unsupported | API key | No supported official account quota/balance endpoint |

### Display and matching rules

- Native providers display every relevant short-term and weekly window returned by their official usage endpoint, including reset countdowns when available.
- The footer follows the active model. `/usage` shows the full metrics retained for each configured source.
- CLIProxyAPI data is never inferred. A CPA Claude or Gemini model shows 5-hour and weekly values only if `pi-bridge` returns distinct 5-hour and weekly pools. If Antigravity returns one shared model pool, Pi Usage displays that one pool and its reset time.
- Proxy accounts and groups are matched by model family and model ID. A model cannot borrow a foreign provider's quota.
- Missing authentication, no active plan, unsupported provider, upstream failure, and a genuine zero balance are separate states. Failures are not converted to `0%`.

Pi Usage uses Pi's resolved provider authentication. CLIProxyAPI is queried through the server-side [`pi-bridge`](https://github.com/abix5/pi-cliproxyapi-bridge), which must be installed on the CLIProxyAPI server. Pi Usage never requests, reads, or stores the CLIProxyAPI Management Key.

Google Vertex quotas are project-, region-, model-, and metric-specific Cloud Quotas/Cloud Monitoring data requiring additional project IAM permissions. They cannot be represented honestly as one footer percentage. Kimi OAuth proves account authentication but does not prove an active paid plan, so an account without usable Kimi Code credits is shown as `No active quota`, not `Unauthorized`.

## Install

Choose one installation source.

### npm

In Pi's terminal:

```bash
pi install npm:@wayner6/pi-usage
```

In pi-web: open **Settings** → **Plugins** → **Add Plugin**, enter the following in **Source**, choose `global`, then select **Install**:

```text
npm:@wayner6/pi-usage
```

### GitHub

In Pi's terminal:

```bash
pi install github:wayner6/pi-usage
```

In pi-web: open **Settings** → **Plugins** → **Add Plugin**, enter the following in **Source**, choose `global`, then select **Install**:

```text
git:https://github.com/wayner6/pi-usage
```

After installing or updating the plugin, reload the session if it is already open.

## Update

In Pi's terminal, update this plugin only:

```bash
pi update npm:@wayner6/pi-usage
```

To update all installed plugins without updating Pi itself:

```bash
pi update --extensions
```

In pi-web: open **Settings** → **Plugins**, select `npm:@wayner6/pi-usage`, choose **Update**, then use **Reload Session**.

## Use

Send a normal message to refresh the quota for the active model. The status line then updates automatically.

In pi-web, an idle model switch is applied when the next message is sent. To refresh it immediately, use **Reload Session**.

Use these commands in the chat input:

| Command | Result |
| --- | --- |
| `/usage` or `/quota` | Show configured provider balances, quotas, and status/error details |
| `/usage current` | Show the active model's provider only |
| `/usage refresh` | Refresh the active provider now |
| `/usage doctor` | Show authentication, adapter, and bridge diagnostics |
| `/usage settings` | Show current plugin settings |

## Settings

Settings are optional. Use `/usage settings` followed by one of these commands:

```text
/usage settings status on|off       # status line; on by default
/usage settings widget on|off       # detailed widget; off by default
/usage settings interval <seconds>  # refresh interval; 120 by default
/usage settings timeout <seconds>   # request timeout; 10 by default
```

Settings are stored locally at `~/.pi/agent/pi-usage/config.json`.

## Privacy

The plugin does not use browser cookies, telemetry, cloud synchronization, or third-party credential forwarding. Requests to provider APIs stay on the provider's official origin.

## Community

Thanks to the [LINUX DO](https://linux.do/) community for discussion and support.

## License

[MIT](./LICENSE)
