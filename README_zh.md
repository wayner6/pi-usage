# Pi Usage

**为 [Pi](https://github.com/earendil-works/pi-mono) 与 pi-web 提供实时模型服务商余额、滑动配额窗口与速率限制监控。**

[English Documentation](./README.md)

Pi Usage 是一个可扩展且注重隐私保护的模型用量监控扩展。它能够在 Pi 终端 TUI 和 pi-web 网页界面中，实时显示当前模型的账户余额、多层级滑动配额窗口（如 5h/7d）以及订阅限制状态。

---

## 支持的模型商与连接认证方式

Pi Usage 直接复用本地 Pi 环境中已配置的官方凭据（`~/.pi/agent/auth.json` 与 `models.json`），无需二次输入密码：

| 模型服务商 / 目标 | 认证方式 | 监控的额度 / 余额数据 |
| :--- | :--- | :--- |
| **OpenAI Codex** | **OAuth** (ChatGPT Plus / Pro) | 调用官方 `wham/usage` 接口，同时展示 5 小时与 7 天滑动配额窗口及重置倒计时 |
| **DeepSeek 官方直连** | **API Key** | 官方余额接口，展示人民币或美元总余额，细分赠送额度与充值额度 |
| **xAI / Grok** | **OAuth** | 校验 OAuth 用户身份与探测扣费/限额状态（Active / 达到 Spending Limit） |
| **Anthropic Claude** | **OAuth 与 API Key** | 双模式支持：Claude Pro/Max OAuth 订阅状态识别，或官方 API Key 响应头实时速率限制 |
| **GLM / 智谱 BigModel** | **API Key** | 双模式支持：GLM Coding Plan 5h/7d 窗口及 MCP 限额解析，普通 API Key 识别为按量计费 |
| **CLIProxyAPI 聚合代理** | **API Key / Bridge** | 通过服务端的轻量 [`pi-bridge`](https://github.com/abix5/pi-cliproxyapi-bridge) 插件，安全读取代理背后的上游分组配额与重置时间 |

---

## 核心功能

- **多窗口配额聚合展示**：原生支持同一模型家族多周期配额并排显示（例如 `Codex 5h 92% · 7d 85%` 或 `GLM 5h 100% · 7d 98%`）。
- **动态跟随模型**：底部状态栏紧凑跟随当前正在使用的模型切换。
- **通用模糊模型匹配**：智能识别带有自定义前缀或别名的模型（如 `my-proxy/gemini-2.5`、`claude-3.7-custom`），纯数据驱动打分，无需手动硬编码。
- **安全与隐私保护**：
  - 零浏览器 Cookie 拦截、零遥测、无第三方云端上传。
  - 绝不索取、存储 CLIProxyAPI 管理密钥。
  - 严格限制同源请求与重定向凭据保护。
  - 网络或接口异常绝不误报为 0% 额度。

---

## 安装教程

### 前置要求
- 已安装并配置好 [Pi Coding Agent](https://github.com/earendil-works/pi-mono) (`pi`)。

### 方式一：从 GitHub 直接安装（推荐）
```bash
pi install github:wayner6/pi-usage
```

### 方式二：本地开发安装
克隆代码库到本地，安装依赖并注册到 Pi：
```bash
git clone https://github.com/wayner6/pi-usage.git
cd pi-usage
npm install
npm run verify

# 安装至 Pi 全局扩展：
pi install .

# 或者仅在当前会话临时加载测试：
pi -e .
```

*如果使用 **pi-web**，只需确保在 pi-web 运行的 Pi 环境中安装了本扩展，启动或重启 pi-web 即可。*

---

## 使用教程与刷新机制

### 实时刷新机制说明
1. **对话开始后自动流式刷新（最省心）**：
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
| `/usage settings` | 查看或修改插件设置（状态栏开关、小部件开关、刷新间隔等） |

### 快速个性化配置

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
