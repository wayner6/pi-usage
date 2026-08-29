# Pi Usage

Pi Usage 是一个适用于 [Pi](https://github.com/earendil-works/pi-mono) 和 [pi-web](https://github.com/agegr/pi-web) 的插件，用于显示当前模型所属服务商的余额或额度。

## 能看到什么

- 当前模型的简洁状态栏，例如：`Codex · 5h 92% · 7d 85%`。
- 服务商公开提供的剩余额度、限流窗口和重置时间。
- 通过 `/usage` 查看所有已配置服务商的详细信息。

显示会随当前模型切换。请求失败时不会被错误显示为余额或额度为零。

## 支持的服务商

| 服务商 | 认证方式 | 可显示的信息 |
| --- | --- | --- |
| OpenAI Codex | ChatGPT Plus/Pro OAuth | 5 小时、7 天额度窗口 |
| xAI / Grok | OAuth | 账户验证和消费限额状态 |
| Anthropic Claude | Claude OAuth 或 API Key | 订阅状态或 API 限流响应头 |
| DeepSeek | API Key | 账户余额 |
| GLM / 智谱 BigModel | API Key | Coding Plan 额度窗口；普通按量付费 Key 无法通过官方 API 查询 |
| CLIProxyAPI | `pi-bridge` | 上游额度窗口和重置时间 |

Pi Usage 复用 Pi 中已有的服务商认证。CLIProxyAPI 通过服务端 [`pi-bridge`](https://github.com/abix5/pi-cliproxyapi-bridge) 查询；插件不会读取或保存其 Management Key。

## 安装

任选一种安装来源。

### npm 安装

在 Pi 终端中执行：

```bash
pi install npm:@wayner6/pi-usage
```

在 pi-web 中：打开 **设置** → **插件** → **添加插件**，在 **Source** 中填入以下内容，作用域选择 `global`，然后点击 **安装**：

```text
npm:@wayner6/pi-usage
```

### GitHub 安装

在 Pi 终端中执行：

```bash
pi install github:wayner6/pi-usage
```

在 pi-web 中：打开 **设置** → **插件** → **添加插件**，在 **Source** 中填入以下内容，作用域选择 `global`，然后点击 **安装**：

```text
git:https://github.com/wayner6/pi-usage
```

安装或更新插件后，如果当前会话已经打开，请重载会话。

## 更新

在 Pi 终端中，只更新这个插件：

```bash
pi update npm:@wayner6/pi-usage
```

只更新全部已安装插件，不更新 Pi 本身：

```bash
pi update --extensions
```

在 pi-web 中：打开 **设置** → **插件**，选择 `npm:@wayner6/pi-usage`，点击 **更新**，然后使用 **重新加载会话**。

## 使用

发送一条普通消息后，插件会刷新当前模型的额度，并更新状态栏。

在 pi-web 中，空闲时切换模型会在发送下一条消息后生效并更新状态栏。如需立即刷新，请使用 **重载会话**。

在对话输入框中使用以下命令：

| 命令 | 作用 |
| --- | --- |
| `/usage` 或 `/quota` | 查看全部可用服务商的余额和额度 |
| `/usage current` | 只查看当前模型所属服务商 |
| `/usage refresh` | 立即刷新当前服务商 |
| `/usage doctor` | 查看认证、适配器和桥接服务诊断信息 |
| `/usage settings` | 查看当前插件设置 |

## 设置

设置为可选项。在对话框中输入 `/usage settings`，再使用以下命令：

```text
/usage settings status on|off       # 底部状态栏，默认开启
/usage settings widget on|off       # 详细小部件，默认关闭
/usage settings interval <秒数>     # 刷新间隔，默认 120 秒
/usage settings timeout <秒数>      # 请求超时，默认 10 秒
```

配置仅保存在本地：`~/.pi/agent/pi-usage/config.json`。

## 隐私

插件不使用浏览器 Cookie、遥测、云同步或第三方凭据转发。对服务商 API 的请求始终发送至服务商官方域名。

## 社区

感谢 [LINUX DO](https://linux.do/) 社区提供交流与支持。

## 许可证

[MIT](./LICENSE)
