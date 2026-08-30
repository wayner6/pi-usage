# Pi Usage

Pi Usage 是一个适用于 [Pi](https://github.com/earendil-works/pi-mono) 和 [pi-web](https://github.com/agegr/pi-web) 的插件，用于显示当前模型所属服务商的余额或额度。

## 能看到什么

- 当前模型的简洁状态栏，例如：`Codex · 5h 92% (resets in 2h) · 7d 85% (resets in 5d 3h)`。
- 服务商公开提供的剩余余额、额度/限流窗口和重置时间。
- 通过 `/usage` 查看已配置服务商的详细信息，包括不可用和不支持状态。

显示会随当前模型切换。服务商返回重置时间时，额度窗口会显示重置倒计时；请求失败不会被错误转换为余额或额度为零。

## 服务商支持情况

| 服务商 | 支持级别 | 认证方式 | 实际显示内容 |
| --- | --- | --- | --- |
| OpenAI Codex | 额度 | ChatGPT Plus/Pro OAuth | 5 小时与 7 天剩余额度及重置倒计时 |
| Anthropic Claude | 额度 / 有限支持 | Claude OAuth 或 API Key | OAuth：5 小时与 7 天订阅额度；API Key：仅请求数/Token 限流余量 |
| DeepSeek | 余额 | API Key | 官方接口返回的各币种账户余额 |
| GLM / 智谱 BigModel | 额度 / 有限支持 | API Key | Coding Plan：5 小时与 7 天额度；普通按量付费 Key：官方没有余额/额度查询接口 |
| OpenRouter | 余额 | OAuth 解析出的 Key 或 API Key | 账户余额或 Key 剩余限额，以及累计消耗 |
| OpenCode Go | 额度 | API Key | 5 小时、周、月滚动窗口；底部显示 5 小时和周额度，`/usage` 显示全部窗口 |
| Kimi Code | 额度 / 状态 | Kimi OAuth 或 Kimi Code API Key | 有效套餐：5 小时与周额度；无有效套餐或额度耗尽：`No active quota` |
| CLIProxyAPI | 取决于上游 | 代理 API Key + 服务端 `pi-bridge` | 只显示 `pi-bridge` 实际返回的账户和额度池 |
| xAI / Grok | 仅状态 | OAuth | 账户身份和可用/消费限额状态；没有数值型订阅额度 |
| Google Vertex AI | 不支持额度 | API Key、ADC 或服务账号 | 明确显示 `Unsupported`；不存在单一的订阅式额度窗口 |
| Google Gemini API / AI Studio | 不支持额度 | API Key | 暂无可用的官方账户额度/余额查询接口 |

### 显示与匹配规则

- 原生服务商会显示其官方用量接口返回的相关短期和周度窗口；接口提供重置时间时，同时显示重置倒计时。
- 底部状态栏跟随当前模型；`/usage` 显示每个已配置来源保留的完整指标。
- CLIProxyAPI 数据绝不推测。只有 `pi-bridge` 返回独立的 5 小时和周额度池时，CPA 中的 Claude 或 Gemini 才会显示两个窗口；如果 Antigravity 只返回一个共享模型池，Pi Usage 只显示该额度池及其重置时间。
- 代理账户和额度组按模型族与模型 ID 匹配，当前模型不会借用其他服务商的额度。
- 缺少认证、没有有效套餐、服务商不支持、上游请求失败和真实的零余额是不同状态；请求失败不会被转换成 `0%`。

Pi Usage 复用 Pi 已解析的服务商认证。CLIProxyAPI 通过服务端 [`pi-bridge`](https://github.com/abix5/pi-cliproxyapi-bridge) 查询，因此必须在 CLIProxyAPI 服务端安装该插件。Pi Usage 不会请求、读取或存储 CLIProxyAPI Management Key。

Google Vertex 的额度属于项目、地区、模型和指标等多维 Cloud Quotas/Cloud Monitoring 数据，并需要额外的项目 IAM 权限，无法诚实地压缩成一个底部百分比。Kimi OAuth 只能证明账户认证成功，不能证明存在有效付费套餐；没有可用 Kimi Code 额度时显示 `No active quota`，而不是 `Unauthorized`。

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
| `/usage` 或 `/quota` | 查看已配置服务商的余额、额度以及状态/错误详情 |
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
