# Pi Usage

**Real-time provider balances, quota windows, and rate limits for [Pi](https://github.com/earendil-works/pi-mono) and pi-web.**

[简体中文文档](./README_zh.md)

Pi Usage is an extensible, privacy-first monitor for your AI model providers. It automatically tracks remaining balances, multi-tier sliding quota windows, and subscription limits, displaying them directly in your status line and widget across both the Pi terminal TUI and the pi-web interface.

---

## Supported Providers & Authentication Types

Pi Usage natively connects to official provider backends using the authentication credentials configured in your local Pi environment (`~/.pi/agent/auth.json` and `models.json`):

| Provider / Target | Auth Type | Monitored Quota / Balance Data |
| :--- | :--- | :--- |
| **OpenAI Codex** | **OAuth** (ChatGPT Plus / Pro) | 5-hour and 7-day official sliding quota windows via `https://chatgpt.com/backend-api/wham/usage` |
| **DeepSeek Direct** | **API Key** | Exact monetary balance (granted balance + topped-up balance in CNY/USD) via official `/user/balance` |
| **xAI / Grok** | **OAuth** | User identity verification and active spending/credit limit status probe |
| **Anthropic Claude** | **OAuth & API Key** | Dual-mode: Claude Pro/Max OAuth subscription detection or official API Key rate limits via `anthropic-ratelimit-*` headers |
| **GLM / 智谱 BigModel** | **API Key** | Dual-mode: GLM Coding Plan sliding quota windows (5h, 7d, and MCP tool limits) via `/api/monitor/usage/quota/limit`, or Pay-as-you-go key identification |
| **CLIProxyAPI Proxies** | **API Key / Bridge** | Upstream provider quota windows, group limits, and reset times via the server-side [`pi-bridge`](https://github.com/abix5/pi-cliproxyapi-bridge) plugin |

---

## Features

- **Universal Multi-Window Quota Display**: Simultaneous tracking for multiple time windows within the same provider family (e.g. `Codex 5h 92% · 7d 85%` or `GLM 5h 100% · 7d 98%`).
- **Dynamic Context Awareness**: The compact footer status bar automatically switches to follow your active model.
- **Universal Fuzzy Model Matching**: Intelligently pairs arbitrary model IDs and user prefixes (e.g. `my-proxy/gemini-2.5`, `claude-3.7-custom`) to their corresponding upstream quota groups without hardcoding.
- **Security & Privacy First**:
  - Zero browser cookies, telemetry, or third-party cloud sync.
  - Never prompts for or stores CLIProxyAPI Management Keys.
  - All external requests strictly enforce same-origin checks and credential redirection guards.
  - Network errors are clearly labeled and never falsely displayed as 0% balance or depleted quota.

---

## Installation

### Prerequisites
- [Pi Coding Agent](https://github.com/earendil-works/pi-mono) (`pi`) installed and configured.

### Option 1: Install from GitHub (Recommended)
```bash
pi install github:wayner6/pi-usage
```

### Option 2: Local Installation (For Development)
Clone this repository to your machine, install dependencies, and register it:
```bash
git clone https://github.com/wayner6/pi-usage.git
cd pi-usage
npm install
npm run verify

# Install into Pi globally:
pi install .

# Or run Pi with the extension loaded temporarily:
pi -e .
```

*For **pi-web**, simply ensure the package is installed in your Pi environment, then start or restart `pi-web`.*

---

## Usage & Refresh Behavior

### Real-Time Refresh Mechanism
1. **Automatic Refresh on Dialogue (Streaming)**:
   - In both the `pi` terminal TUI and the `pi-web` interface, **starting a conversation (sending any prompt) immediately refreshes and streams the active model's latest balance or quota**.
2. **Model Switching in pi-web**:
   - In `pi-web`, when switching models while the agent is idle, the browser's background event connection remains in a paused state. The footer quota for your newly selected model will **automatically synchronize as soon as you send your next message**.
   - If you want to view the updated quota immediately before sending a message, click **"Reload Session"** in the session menu or sidebar, and the footer will refresh instantly.
3. **Background Polling**:
   - Pi Usage continuously updates quota countdowns and balances in the background (default: every 120 seconds).

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

You can adjust preferences directly in chat via `/usage settings`:
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
