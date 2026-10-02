<div align="center">

# Pi Usage

为 [Pi](https://github.com/earendil-works/pi-mono) 和 [pi-web](https://github.com/agegr/pi-web) 显示 ChatGPT OAuth 与 CLIProxyAPI 额度窗口、重置时间，并在本地统计 Skill 使用次数。

[English](./README.md) · [反馈问题](https://github.com/wayner6/pi-usage/issues)

</div>

## 功能概览

Pi Usage 会为当前模型添加一条简洁的状态信息：

```text
Codex · 5h 92% (resets in 2h) · 7d 85% (resets in 5d 3h)
```

需要查看详细信息或 Skill 统计时，使用：

```text
/usage
/usage skills
```

状态会跟随当前模型切换。只查询 ChatGPT OAuth（OpenAI Codex）与安装了 `pi-bridge` 的 CLIProxyAPI；其他原生服务商显示不支持。网络错误、认证缺失、不支持、额度耗尽和真实的零额度会显示为不同状态。

## 使用演示

### 使用 `/usage` 查看服务商详情

<table>
  <tr>
    <th>Pi 终端</th>
    <th>pi-web</th>
  </tr>
  <tr>
    <td><a href="https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/pi%E7%BB%88%E7%AB%AF%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA3.png"><img src="https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/pi%E7%BB%88%E7%AB%AF%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA3.png" alt="Pi 终端执行 /usage 命令的效果" width="100%"></a></td>
    <td><a href="https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/Pi-web%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA3.png"><img src="https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/Pi-web%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA3.png" alt="pi-web 执行 /usage 命令的效果" width="100%"></a></td>
  </tr>
</table>

### 在底部查看当前模型额度

<table>
  <tr>
    <th>Pi 终端</th>
    <th>pi-web</th>
  </tr>
  <tr>
    <td><a href="https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/pi%E7%BB%88%E7%AB%AF%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA1.png"><img src="https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/pi%E7%BB%88%E7%AB%AF%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA1.png" alt="Pi 终端底部显示当前模型额度" width="100%"></a></td>
    <td><a href="https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/Pi-web%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA1.png"><img src="https://pub-c84d97a350ed4cc28061354413a4fd68.r2.dev/2026/08/Pi-web%E6%8F%92%E4%BB%B6%E6%BC%94%E7%A4%BA1.png" alt="pi-web 底部显示当前模型额度" width="100%"></a></td>
  </tr>
</table>

点击图片可查看原图。

## 安装

可以从 npm 或 GitHub 安装。

### Pi 终端

```bash
# npm
pi install npm:@wayner6/pi-usage

# GitHub
pi install github:wayner6/pi-usage
```

### pi-web

打开 **设置 > 插件 > 添加插件**，作用域选择 `global`，然后填写其中一个来源：

```text
npm:@wayner6/pi-usage
```

```text
git:https://github.com/wayner6/pi-usage
```

安装或更新后，请重新加载当前会话。

## 命令

Pi Usage 只注册 `/usage` 这一个命令。

| 命令 | 作用 |
| --- | --- |
| `/usage` | 查看已配置的 ChatGPT OAuth 与 CLIProxyAPI 服务商 |
| `/usage all` | 与 `/usage` 相同 |
| `/usage current` | 只查看当前模型所属服务商 |
| `/usage refresh` | 跳过缓存，立即刷新当前服务商 |
| `/usage doctor` | 查看当前模型、适配器、认证状态和桥接诊断 |
| `/usage skills` | 列出所有已安装 Skill 及其累计使用次数，包括零次 |
| `/usage settings` | 查看插件设置和配置文件位置 |

### Skill 计数方式

Pi 暂时没有提供独立的 `skill_invoked` 事件。Pi Usage 会在以下两种情况下识别一次 Skill 激活：

1. `/skill:name` 命令被 Pi 接收并进入 Agent Run（提交失败或队列取消不计数）。
2. 模型成功读取 Pi 已发现 Skill 的入口文件。

同一个 Agent Run 内，同一 Skill 只计一次。因此，先执行 `/skill:name`，随后模型再读取它的 `SKILL.md`，最终只增加一次，不会重复计数。

统计从安装并开启该功能后开始，不会扫描旧会话。`/usage skills` 会列出 Pi 当前发现的全部 Skill，从未使用过的 Skill 显示为 `0`。

## 服务商支持

| 服务商 | 支持级别 | 认证方式 | 显示内容 |
| --- | --- | --- | --- |
| OpenAI Codex | 完整额度 | 仅 ChatGPT Plus/Pro OAuth | 主额度的 5 小时、7 天窗口，以及接口返回的额外模型额度 |
| CLIProxyAPI | 取决于上游 | 代理 API Key 和服务端 `pi-bridge` | 只显示 `pi-bridge` 返回的账户和额度池 |

其他原生服务商均不查询额度，显示不支持。CPA 可能展示 `pi-bridge` 返回的其他上游服务额度池，但这不代表插件对这些服务提供原生集成。

### 服务商数据如何处理

ChatGPT OAuth 使用官方 ChatGPT 域名查询，不使用普通 API Key。账户 ID 从当前解析的 OAuth token 获取，不再另读认证文件。额外模型额度在 `/usage` 详情中展示；简洁状态仍以主额度窗口为主。只有服务商返回重置时间时，插件才会显示倒计时。

CLIProxyAPI 需要在服务端安装 [`pi-bridge`](https://github.com/abix5/pi-cliproxyapi-bridge)。Pi Usage 使用普通代理 API Key，不会请求或保存 CLIProxyAPI Management Key。界面只展示桥接接口实际返回的账户和额度池。

代理账户会按模型族和模型 ID 匹配，当前模型不能借用无关服务商的额度。共享额度池仍按一个池显示。例如，Antigravity 只返回一个共享池时，插件不会凭空拆成 5 小时和周额度。

## 状态说明

| 状态 | 含义 |
| --- | --- |
| `Unauthorized` | Pi 没有解析到有效凭据，或服务商拒绝了凭据 |
| `No active quota` | 认证成功，但账户没有可用套餐或额度 |
| `Unsupported` | 此服务商不在支持的额度集成范围内 |
| `Bridge Not Found` | CLIProxyAPI 可以访问，但没有安装 `pi-bridge` |
| `stale` | 本次刷新失败，当前显示的是上次成功获取的数据 |
| `0%` | 服务商成功返回了真实的零额度 |

## 设置

```text
/usage settings status on|off       # 简洁状态信息，默认开启
/usage settings widget on|off       # 输入框下方的详细信息，默认关闭
/usage settings skills on|off       # 本地 Skill 计数，默认开启
/usage settings interval <秒数>     # 自动刷新间隔，30 到 3600，默认 120
/usage settings timeout <秒数>      # 请求超时，2 到 60，默认 10
```

本地文件位置：

```text
~/.pi/agent/pi-usage/config.json
~/.pi/agent/pi-usage/skill-usage.jsonl
```

Skill 日志采用追加写入，只保存 Skill 名称和时间。

## 更新

```bash
# 更新通过 npm 安装的 Pi Usage
pi update npm:@wayner6/pi-usage

# 更新全部扩展，但不更新 Pi 本身
pi update --extensions
```

在 pi-web 中，打开 **设置 > 插件**，更新 Pi Usage，然后重新加载会话。

## 隐私与安全

Pi Usage 不使用浏览器 Cookie、遥测或云同步，也不会把凭据发送到第三方域名。ChatGPT 请求只会发往官方域名，CLIProxyAPI 请求只会发往已配置的代理源站。

Skill 统计不会保存提示词、对话内容、工具输出或 Skill 文件内容。

安全问题请参考 [SECURITY.md](./SECURITY.md)。

## 开发

```bash
npm install
npm run verify
npm run pack:check
```

`npm run verify` 会执行 TypeScript 检查和完整测试。提交修改前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 社区

感谢 [LINUX DO](https://linux.do/) 社区参与测试和讨论。

## 许可证

[MIT](./LICENSE)
