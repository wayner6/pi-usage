<div align="center">

# Pi Usage

在 [Pi](https://github.com/earendil-works/pi-mono) 和 [pi-web](https://github.com/agegr/pi-web) 中查看当前模型的剩余额度、重置时间，以及本地 Skill 使用次数。

[English](./README_EN.md) · [安装](#安装) · [使用](#使用) · [反馈问题](https://github.com/wayner6/pi-usage/issues)

</div>

## 功能

- 在底部显示当前模型的额度，切换模型时同步切换。
- 用 `/usage` 查看服务商、账户和额度窗口的详情。
- 用 `/usage skills` 查看已安装 Skill 的累计使用次数，包括从未使用过的 Skill。

状态栏显示示例：

```text
Codex · 5h 92% (resets in 2h) · 7d 85% (resets in 5d 3h)
```

Pi Usage 安装在 Pi / pi-web 中。使用原生 OAuth 时，直接查询服务商额度；使用 CLIProxyAPI（CPA）时，还需在 CPA 服务端安装配套插件。

| 你使用的连接方式 | 需要安装 |
| --- | --- |
| Pi 原生 OAuth | 本项目 |
| CPA API Key | 本项目 + 服务端 [pi-usage-cpa](https://github.com/wayner6/pi-usage-cpa#安装) |

## 安装

推荐从 GitHub 安装，当前版本为 **0.6.1**。npm latest 仍是旧版 `0.3.0`，不支持新的 CPA 服务端插件。

### pi-web

1. 打开 **设置 → 插件 → 添加插件**。
2. 作用域选择 `global`，填写来源：

   ```text
   git:https://github.com/wayner6/pi-usage
   ```

3. 安装后重新加载当前会话。

如果已安装 npm 版，先移除旧插件，再添加 GitHub 来源，避免同时加载两份。

### Pi 终端

```bash
pi install github:wayner6/pi-usage
```

安装后重新加载当前会话。

<details>
<summary>旧 npm 版安装方式</summary>

npm `0.3.0` 不具备本文所述的新版 CPA 集成。需要该功能时，请使用上面的 GitHub 来源。

Pi 终端：

```bash
pi install npm:@wayner6/pi-usage
```

pi-web 插件来源：

```text
npm:@wayner6/pi-usage
```

</details>

### 使用 CPA 的额外步骤

1. 在 CPA 服务端按 [pi-usage-cpa 安装说明](https://github.com/wayner6/pi-usage-cpa#安装)安装 **v0.2.3 或更新版本**。
2. 在 Pi / pi-web 中使用已有的 CPA 模型配置和普通 API Key。管理密钥只配置在服务端。
3. 选择 CPA 模型，执行 `/usage doctor`。适配器应为 `pi-usage-cpa`；再用 `/usage current` 查看额度。

原生 OAuth 用户不需要安装服务端插件。

## 使用

先选择已配置且受支持的模型，然后输入：

```text
/usage current
```

底部默认显示简洁额度。如需输入框下方的详细信息，可开启 widget：

```text
/usage settings widget on
```

### 命令

| 命令 | 用途 |
| --- | --- |
| `/usage` 或 `/usage all` | 查看所有受支持的已配置服务商 |
| `/usage current` | 查看当前模型所属服务商 |
| `/usage refresh` | 跳过客户端缓存，刷新当前服务商；服务端仍可能限流 |
| `/usage doctor` | 查看当前模型、适配器和认证状态，排查连接问题 |
| `/usage skills` | 查看所有已安装 Skill 的累计使用次数 |
| `/usage settings` | 查看设置和本地文件位置 |

### Skill 如何计数

以下任一情况记为一次使用：被接受的 `/skill:name` 命令进入 Agent Run，或模型成功读取 Pi 已发现 Skill 的入口文件。同一个 Agent Run 内，同一 Skill 只计一次；失败、取消的命令和失败的读取不计数。

计数从安装并开启统计后开始，不扫描旧会话。日志只保存 Skill 名称和时间，不保存对话或文件内容。

### 界面预览

<details>
<summary>查看 Pi 终端和 pi-web 截图</summary>

| | Pi 终端 | pi-web |
| --- | --- | --- |
| `/usage` 详情 | [![Pi 终端额度详情][pi-details]][pi-details] | [![pi-web 额度详情][web-details]][web-details] |
| 底部状态 | [![Pi 终端底部状态][pi-status]][pi-status] | [![pi-web 底部状态][web-status]][web-status] |

点击图片查看原图。

</details>

[pi-details]: https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/pi%E7%BB%88%E7%AB%AF%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA3.png
[web-details]: https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/Pi-web%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA3.png
[pi-status]: https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/pi%E7%BB%88%E7%AB%AF%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA1.png
[web-status]: https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/Pi-web%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA1.png

## 支持的服务商

### 原生 OAuth

使用 Pi 已解析的 OAuth 凭据，无需另填额度查询密钥。

| 服务商 | 可显示的数据 |
| --- | --- |
| OpenAI Codex | 主额度的 5h、7d，以及接口返回的额外模型额度 |
| Anthropic | 5h、7d 和模型专属周额度；接口未公开文档，可能限流 |
| Kimi Code | 7d 及实际返回的滚动 5h；接口未公开文档 |
| OpenRouter | Key 消费上限和免费模型日请求额度（若有），不是账户余额 |

### 通过 CPA

支持服务端插件返回的 Antigravity、Claude、Codex、Kimi、xAI、Devin、Meta 额度。各服务商的数据范围见 [服务端支持表](https://github.com/wayner6/pi-usage-cpa#支持的服务商)。

Antigravity 的共享额度匹配 Claude 和 GPT-OSS；其他 GPT 模型匹配 Codex。多个账户都能匹配当前模型、但实际路由账户未知时，会显示 `N accounts · routing account unknown`，不会任意选一个或合并额度。

额度和重置时间只展示上游实际返回的数据。未知窗口保留 `window unknown`，不会从重置时间或余额推算 5h / 7d；没有可查询额度的服务商不显示额度。

## 设置与更新

```text
/usage settings status on|off       # 简洁状态，默认开启
/usage settings widget on|off       # 详细信息，默认关闭
/usage settings skills on|off       # Skill 统计，默认开启
/usage settings interval <秒数>     # 自动刷新：30–3600 秒，默认 120
/usage settings timeout <秒数>      # 请求超时：2–60 秒，默认 10
```

本地配置与统计日志：

```text
~/.pi/agent/pi-usage/config.json
~/.pi/agent/pi-usage/skill-usage.jsonl
```

pi-web 在 **设置 → 插件** 中更新 Pi Usage。Pi 终端可更新全部扩展，而不更新 Pi 本身：

```bash
pi update --extensions
```

旧 npm 安装可用 `pi update npm:@wayner6/pi-usage` 更新，但不会切换到 GitHub 来源。更新后都需重新加载会话。

## 常见问题

遇到问题先执行 `/usage doctor`，确认当前模型、适配器和认证状态。

| 显示内容 | 含义与处理 |
| --- | --- |
| `Unauthorized` | 未解析到有效凭据，或请求被拒绝；检查登录状态或普通 CPA API Key |
| `Bridge Not Found` | CPA 插件接口不可用；检查服务端插件是否已注册、生效。客户端不会回退 `pi-bridge` |
| `No Quota` / `unavailable` | 没有可识别或可匹配的额度，不表示余额为零 |
| `window unknown` | 有额度比例，但上游没有明确窗口 |
| `routing account unknown` | 多个账户都可匹配，尚不知道实际路由账户 |
| `stale` | 本次刷新失败，暂时保留上次成功的数据 |
| `0%` | 上游确实返回了零剩余额度 |

CPA 场景中，服务商的 `[ok]` 表示插件响应可读取；账户仍可能单独返回额度查询错误。请结合 `/usage` 中的账户信息判断。

## 隐私与安全

原生 OAuth 额度请求只发送到服务商的固定官方源站，认证请求不跨域跟随重定向。CPA 请求只发送到已配置的代理源站，使用普通 API Key；客户端不请求或保存 CPA 管理密钥。

不使用浏览器 Cookie、遥测或云同步。Skill 统计不保存提示词、对话、工具输出或 Skill 文件内容。安全问题请参阅 [SECURITY.md](./SECURITY.md)。

## 开发

```bash
npm install
npm run verify
npm run pack:check
```

`verify` 执行 TypeScript 检查和测试；`pack:check` 检查打包内容。贡献说明见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

感谢 [LINUX DO](https://linux.do/) 社区参与测试和讨论。

## 许可证

[MIT](./LICENSE)
