# Pi Usage

[中文文档](./README_zh.md)

Pi Usage is a [Pi](https://github.com/earendil-works/pi-mono) and [pi-web](https://github.com/agegr/pi-web) plugin that shows the balance or quota of the provider behind the active model.

## What it shows

- A compact status line for the active model, such as `Codex · 5h 92% · 7d 85%`.
- Remaining balance, rate-limit windows, and reset times when the provider exposes them.
- Details for every configured provider through `/usage`.

The display follows the active model. It does not turn request failures into a zero balance.

## Supported providers

| Provider | Authentication | Available information |
| --- | --- | --- |
| OpenAI Codex | ChatGPT Plus/Pro OAuth | 5-hour and 7-day quota windows |
| xAI / Grok | OAuth | Account verification and spending-limit status |
| Anthropic Claude | Claude OAuth or API key | Subscription status or API rate-limit headers |
| DeepSeek | API key | Account balance |
| GLM / Zhipu BigModel | API key | Coding Plan quota windows; standard pay-as-you-go keys cannot be queried through the official API |
| OpenRouter | API key | Account balance (total_credits - total_usage) |
| OpenCode Go | API key | Rolling 5h / weekly / monthly quota windows |
| CLIProxyAPI | `pi-bridge` | Upstream quota windows and reset times |

Pi Usage uses Pi's existing provider authentication. CLIProxyAPI is queried through server-side [`pi-bridge`](https://github.com/abix5/pi-cliproxyapi-bridge); its Management Key is never read or stored by this plugin.

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
| `/usage` or `/quota` | Show all available provider balances and quotas |
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
