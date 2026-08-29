# Pi Usage

**Real-time provider balances, quota windows, and rate limits for [Pi](https://github.com/earendil-works/pi-mono) and [pi-web](https://github.com/agegr/pi-web).**

[简体中文文档](./README_zh.md)

---

## Supported Providers & Authentication Types

| Provider / Target | Auth Type | Monitored Quota / Balance Data |
| :--- | :--- | :--- |
| **OpenAI Codex** | **OAuth** (ChatGPT Plus / Pro) | Official 5-hour and 7-day sliding quota windows with reset countdowns |
| **xAI / Grok** | **OAuth** | Identity verification and active spending/credit limit status probe |
| **Anthropic Claude** | **OAuth** / **API Key** | Claude Pro/Max OAuth subscription detection or official API Key rate limits via headers |
| **DeepSeek Direct** | **API Key** | Exact account monetary balance (granted + topped-up in CNY/USD) |
| **GLM / 智谱 BigModel** | **API Key** | Coding Plan multi-tier sliding windows (5h, 7d, MCP); notice displayed if using standard Pay-as-you-go key (official API only supports quota display for Coding Plan) |
| **CLIProxyAPI Proxies** | **API Key / Bridge** | Upstream quota windows and reset intervals via server-side [`pi-bridge`](https://github.com/abix5/pi-cliproxyapi-bridge) |

---

## Key Features

- **Real-Time Quota & Multi-Window Tracking**: Automatically monitors balances, subscription states, and multiple sliding windows (e.g. `Codex 5h 92% · 7d 85%`) tailored to your currently active model.
- **Privacy & Security First**: Zero browser cookies, telemetry, or external proxies—reuses your local Pi credentials securely with strict same-origin protection.

---

## Installation

### Method 1: Install in Pi (CLI / TUI)

Run the following command directly in your terminal:

```bash
pi install npm:@wayner6/pi-usage
```

### Method 2: Install in pi-web (Web Interface)

1. Open **Settings** (设置) at the bottom left -> **Plugins** (插件).
2. Click **+ Add Plugin** (添加插件).
3. In the **Source** input box, enter:
```text
npm:@wayner6/pi-usage
```
4. Choose `global` scope, then click **Install** (安装).

---

## Usage & Refresh Behavior

### Refresh Mechanism
1. **Automatic Refresh on Dialogue**:
   - In both `pi` and `pi-web`, **starting a conversation (sending any prompt) automatically refreshes and streams the latest balance/quota** for the active model.
2. **Model Switching in pi-web**:
   - When switching models while the agent is idle, the footer quota updates **automatically on your next prompt**.
   - To refresh immediately without sending a message, click **"Reload Session"** (重载会话) in the menu or sidebar.
3. **Background Updates**:
   - Polls and updates countdowns periodically in the background (default: every 120s).

### Available Commands

Type `/usage` or `/quota` in the chat input:

| Command | Description |
| :--- | :--- |
| `/usage` | Show aggregated balance and quota details for all configured providers |
| `/usage current` | Show usage details specifically for the currently active model |
| `/usage refresh` | Force an immediate network refresh for the current provider |
| `/usage doctor` | Diagnose adapter states, provider authentication, and bridge connectivity |
| `/usage settings` | View or adjust configuration (status bar, widget, intervals) |

### Configuration Options

Adjust preferences directly in chat via `/usage settings`:
```text
/usage settings status on|off       # Toggle the compact footer status line (Default: on)
/usage settings widget on|off       # Toggle the detailed persistent widget (Default: off)
/usage settings interval <seconds>  # Set background polling interval (Default: 120s)
/usage settings timeout <seconds>   # Set request timeout (Default: 10s)
```
Configuration is automatically saved to `~/.pi/agent/pi-usage/config.json`.

---

## License

MIT License. See [LICENSE](./LICENSE) for details.
