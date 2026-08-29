# Pi Usage

**为 [Pi](https://github.com/earendil-works/pi-mono) 与 [pi-web](https://github.com/agegr/pi-web) 提供实时模型服务商余额、滑动配额窗口与速率限制监控。**

---

## 支持的模型商与连接认证方式

| 模型服务商 / 目标 | 认证方式 | 监控的额度 / 余额数据 |
| :--- | :--- | :--- |
| **OpenAI Codex** | **OAuth** (ChatGPT Plus / Pro) | 官方 5 小时与 7 天多层级滑动配额窗口及重置倒计时 |
| **xAI / Grok** | **OAuth** | OAuth 身份校验与扣费上限状态（Active / 达到 Spending Limit） |
| **Anthropic Claude** | **OAuth** / **API Key** | Claude Pro/Max 订阅状态识别，或官方 API Key 响应头实时速率限制 |
| **DeepSeek 官方直连** | **API Key** | 官方余额接口，展示人民币或美元总余额（含赠送额度与充值额度细分） |
| **GLM / 智谱 BigModel** | **API Key** | GLM Coding Plan 5h/7d 窗口及 MCP 限额解析；若为普通按量付费则提示官方仅支持 Coding Plan 显示额度 |
| **CLIProxyAPI 聚合代理** | **API Key / Bridge** | 通过服务端的轻量 [`pi-bridge`](https://github.com/abix5/pi-cliproxyapi-bridge) 插件，安全读取代理背后的上游分组配额与重置时间 |

---

## 核心功能

- **实时配额与多窗口监控**：自动跟踪当前活动模型的账户余额、订阅状态与多周期滑动窗口（如 `Codex 5h 92% · 7d 85%`）。
- **隐私与安全第一**：零 Cookie、零遥测、无第三方云端中转，严格基于同源策略复用本地 Pi 已配置的官方凭据。

---

## 安装教程

### 方式一：在 Pi 终端安装 (CLI / TUI)

在命令行中直接运行：

```bash
pi install github:wayner6/pi-usage
```

### 方式二：在 pi-web 网页端安装

1. 点击左下角齿轮图标打开 **设置** -> **插件**。
2. 点击左下角 **+ 添加插件**。
3. 在 **Source** 输入框中填入：
   ```text
   git:https://github.com/wayner6/pi-usage
   ```
4. 作用域选择 `global`，点击 **安装** 按钮即可。

---

## 使用教程与刷新机制

### 实时刷新机制说明
1. **对话开始后自动流式刷新**：
   - 无论在命令行还是网页端，**只要发起对话（发送任意消息），底部状态栏便会自动流式更新为当前模型的最新额度**。
2. **在 pi-web 中切换模型后的显示机制**：
   - 在 `pi-web` 网页端中，空闲时切换模型属于前端静默操作。底部的配额会在**你发送下一句对话时立即自动更新为新模型的配额**。
   - 如果你在尚未发送消息前就希望立即看到新模型额度，也可以**手动点击会话菜单里的“重载会话”（Reload Session）按钮**，状态栏将瞬间刷新。
3. **后台定时刷新**：
   - 插件默认在后台定期轮询（默认每 120 秒一次），保持配额倒计时与剩余比例的准时更新。

### 常用命令

在对话输入框中输入 `/usage` 或 `/quota`：

| 指令 | 说明 |
| :--- | :--- |
| `/usage` | 弹窗展示所有已配置服务商的额度与余额明细 |
| `/usage current` | 查看当前正在使用的模型服务商配额明细 |
| `/usage refresh` | 强制立即发起网络请求刷新当前模型额度 |
| `/usage doctor` | 一键诊断各服务商认证状态、适配器健康度与网络连通性 |
| `/usage settings` | 查看或修改插件设置（状态栏开关、小部件开关、刷新间隔等） |\n\n### 快速个性化配置

在对话框中直接通过命令调整：
```text
/usage settings status on|off       # 开启/关闭底部紧凑状态栏 (默认: 开启)
/usage settings widget on|off       # 开启/关闭编辑框下方详细小部件 (默认: 关闭)
/usage settings interval <秒数>     # 修改后台轮询间隔秒数 (默认: 120 秒)
/usage settings timeout <秒数>      # 修改网络请求超时时间 (默认: 10 秒)
```
所有配置会自动持久化保存至 `~/.pi/agent/pi-usage/config.json`。

---

## 开源许可

基于 MIT License 协议开源。详见 [LICENSE](./LICENSE) 文件。
