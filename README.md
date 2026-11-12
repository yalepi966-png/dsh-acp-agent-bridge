# dsh-acp-agent-bridge

[English](README.en.md) | [简体中文](README.md)

一个 DeepSeek Harness 插件：把本机安装的编程 Agent CLI 变成可被 ACP 派遣的 subagent。自动探测
Claude Code 与 Codex，每个都用一个开关控制，打开后 Agent 就能把一个自包含任务交给它执行。

![配置页面](docs/preview.png)

---

## 页面设计

**两个入口，同一份数据**：

- DSH 左侧栏底部的 **Agent Bridge** 行（浏览器半 `lib/client.js`）
- 独立页面 `http://127.0.0.1:4319`（宿主半 `lib/server.mjs`）

**布局自上而下**：

| 区域 | 内容 |
|---|---|
| 粘性顶栏 | 标题、启用总览（`已启用 N 个：ask_claude、ask_codex`）、**保存**、**重新探测** |
| 服务端口卡 | 端口输入、**检测**、**确定**；修改后就地重启页面服务 |
| Agent 风琴列表 | 每行：角色标签 + CLI 名、状态胶囊、开关、展开箭头 |

**交互约定**：

- **默认展开第一个 Agent**，同一时间只展开一个；点行头展开/收起。
- 展开体用淡蓝实色底与卡片区分，内含：状态说明、persona 文件路径、CLI 路径、ACP 适配器状态
  与「安装」按钮、角色标签、角色设定（带 `字符数 / 2000` 计数）。
- **保存固定在右上角**，不随内容滚动：它只提交当前展开的 Agent。保存成功底部浮出绿色
  `✓ 保存成功，下一次派遣立即生效`，失败则用红色提示给出原因。
- 状态只有三种：`可以使用`（绿）、`已关闭`（灰）、`不可用`（红）；适配器缺失时单独显示
  `待装适配器`，不会假装可用。
- 视觉：磨砂玻璃卡片、浅色渐变背景、低饱和配色；基准字号 12.5px，窄屏（<640px）自动单列。

---

## 功能基线

| 能力 | 行为 | 状态 |
|---|---|---|
| CLI 自动探测 | 扫 `PATH` + 执行 `--version`；路径回填输入框 | 已验证 |
| 手动指定 CLI | 填绝对路径保存，立即重探；「恢复自动」清空 | 已验证 |
| 每 Agent 开关 | 关闭即不注册工具；开启并保存后模型可见 | 已验证 |
| ACP 派遣 | `initialize → newSession → prompt → 流式收包` | 已验证 |
| Subagent 派遣 | 走 `ctx.subagents.start()`，编队显示独立子 agent | 已实现，待 UI 验收 |
| 适配器按需安装 | 面板点「安装」，后台 npm 安装锁定版本 | 已验证（33s） |
| 版本锁定 | Claude `0.106.0`、Codex `2.6.0`，用户不可选 | 已验证 |
| 角色标签 | ≤10 字，影响工具描述与显示 | 已验证 |
| 角色设定 | Markdown 文件，派遣时注入；≤2000 字 | 已验证 |
| 角色热更新 | 每次派遣重新读文件，改完下一次生效 | 已验证 |
| 首字超时 | 30 秒无输出则取消会话并杀进程 | 已验证 |
| 端口配置 | 检测占用 → 确定 → 就地重启服务 | 已验证 |
| 保存反馈 | 右上角固定按钮 + 悬浮成功提示 | 已验证 |
| 零运行时依赖 | ACP 传输层内置，无 npm dependencies | 已验证 |
| 跨平台探测 | Windows `PATHEXT`、适配器统一 `node <js>` 启动 | 仅 macOS 实测 |

---

## 思路

### 为什么是 ACP，而不是直接调 CLI

直接 `claude -p` 只能拿到一段文本，拿不到结构化的流式事件、权限请求和会话模型。ACP 是编辑器与
Agent 之间的标准协议，适配器会把 CLI 的能力（工具调用、权限、流式输出）翻译过来，插件只需要实现
协议的一小段。代价是多一层适配器进程。

### 为什么自己实现 ACP 客户端

官方 SDK 会引入一个 npm 依赖。而 `git clone` 后本地 `link:` 安装时，包管理器**不会**给被链接的目录
装依赖——宿主半一 `import` 就崩，表现为「面板能打开、接口 Failed to fetch」。ACP 用到的协议面很窄
（`initialize` / `session/new` / `session/prompt` / `session/cancel` + `session/update` 通知 +
`session/request_permission` 请求），用 Node 内置能力实现约 60 行，换来零依赖和任何安装方式都能跑。

### 为什么适配器仍然必要，且按需安装

Claude Code 和 Codex 都不会说 ACP，适配器是官方维护的桥，不能省。但它们体积大（两家平台二进制
合计约 770MB），所以不作为包依赖，改为面板里点「安装」时装到 `~/.dsh/agent-bridge/adapters`，
版本写死在插件内部。插件包本身保持几 MB。

### 为什么用 SubagentProvider，而不是普通工具

工具调用在 DSH 里只是一次函数执行，编队里看不到。注册 `SubagentProvider` 后，派遣经过
`ctx.subagents.start()`，DSH 会发出子 agent 生命周期事件，编队里出现独立子 agent，取消与回收也走
同一套语义。工具仍然保留，是为了给模型一个明确的调用入口。

### 为什么角色存成文件

角色设定是「会反复调的内容」，放进 `config.json` 会让配置越来越难读，也没法用编辑器改。改成
每个 Agent 一个 Markdown（带 `tag` front matter），派遣时重新读取，天然热更新；同时它只是普通任务
文本的前缀，不依赖适配器支持 system prompt。

### 为什么保存固定在右上角

内容一长，位于内容流里的按钮会被顶出视口；固定操作条让「提交」永远可达。代价是保存只作用于当前
展开项——这由折叠结构本身保证，不会误存到别的 Agent。

---

## 依赖

| 依赖 | 说明 |
|---|---|
| DeepSeek Harness | 宿主；插件使用 `ctx.tools` / `ctx.subagents` / `ctx.effect` / `ctx.logger` |
| Claude Code CLI | 可选；要用 `ask_claude` 就必须装好并登录 |
| Codex CLI | 可选；要用 `ask_codex` 就必须装好并登录 |
| Node.js | 不需要单独装，适配器用宿主自带 Node 启动 |
| ACP 适配器 | 在面板里按需安装；版本由插件内部固定 |
| npm 依赖 | **零运行时依赖**：ACP 传输层内置，git / 本地目录安装都不需要额外装包 |

## 安装

```sh
# 从 npm（发布后）
dsh plugin --profile desktop add dsh-acp-agent-bridge

# 或直接从 GitHub 装
dsh plugin --profile desktop add github:yalepi966-png/dsh-acp-agent-bridge
```

包内声明了 `dsh.bundle.patch`，`dsh plugin add` 会自动把插件行插进 profile 组合，**不用手改
`cordis.patch.yml`**。装完重启 DeepSeek Harness。

> **必须用 bundle 方式安装，不要手动插条目。** 手写进 profile 的 `cordis.patch.yml` 只会注册宿主
> 工具，**侧栏入口不会出现**：客户端模块注册表只为 profile bundle 层组合浏览器 bundle。
> `dsh plugin add` 是唯一受支持的路径。

## 使用

1. 从 DSH 左侧栏底部点 **Agent Bridge** 打开面板，或打开 `http://127.0.0.1:4319`。
2. 展开一个 Agent：看状态、确认路径、按需安装适配器。
3. 打开开关，点右上角 **保存**。
4. 让模型派遣，或直接调用：

```
ask_claude: "审一下 src/server.mjs 的并发问题，用编号列表回答。"
```

## 配置

页面写入 `~/.dsh/agent-bridge/config.json`：

```json
{
  "port": 4319,
  "agents": {
    "claude": {
      "enabled": true,
      "command": "",
      "adapterCommand": "",
      "adapterArgs": []
    }
  }
}
```

| 字段 | 含义 |
|---|---|
| `port` | 页面端口；端口被占会自动换一个 |
| `enabled` | 开关；关闭即不注册工具 |
| `command` | CLI 路径；留空表示按名字在 `PATH` 上探测 |
| `adapterCommand` / `adapterArgs` | 覆盖 ACP 适配器；留空表示用按需安装的那份 |

> 旧版本写在 `config.json` 里的 `label` / `persona` 字段已废弃，角色以 personas 文件为准。

### 修改端口

填端口 → **检测**（真实试绑一次）→ **确定**。确定会保存配置并在插件内重启页面服务，不需要重启
应用；面板会记住新地址自动重连，旧端口的浏览器标签页需要重新打开。

## 新增一个 CLI

编辑 `lib/agents.mjs`：

```js
{
  id: 'gemini',
  label: 'Gemini CLI',
  bin: 'gemini',
  adapter: { package: '@agentclientprotocol/gemini-acp', bin: 'gemini-acp', version: '1.0.0' },
}
```

探测、注册、页面、派遣都会自动跟上。前提是该 CLI 有 ACP 适配器；插件不做“直调 CLI”兜底，避免两套
派遣语义并存。

## 角色标签与角色设定

每个 Agent 一个 Markdown 文件：

```
~/.dsh/agent-bridge/personas/claude.md
~/.dsh/agent-bridge/personas/codex.md
```

```markdown
---
tag: 审查官
---
你是「审查官」，只对代码与方案做严格审查。
- 先列问题，按严重程度排序……
```

首次启动自动写入默认：

| Agent | 默认标签 |
|---|---|
| Claude Code | 创意官 |
| Codex | 审查官 |

派遣时拼在任务最前面：

```
【角色】你是「审查官」。
<角色设定正文>

【任务】
<调用方的任务>
```

没写设定时任务原样发送。

## 适配器

面板每个 Agent 显示适配器状态：`未安装` / `已安装 · 版本` / `自定义`。缺失时点「安装」，宿主用自带
的 npm 在后台安装锁定版本到 `~/.dsh/agent-bridge/adapters`，装完自动重探并注册。适配器未就绪时
开关不生效、工具不注册。

## Subagent 派遣

插件向宿主注册两个 SubagentProvider（`claude` / `codex`）。工具调用走
`ctx.subagents.start(provider, …)`，每次派遣都是真正的子 agent 运行，编队里可见，取消与回收走同一
套生命周期。

子 agent 是远程运行（`localAgent` 为空）：有独立进程与 ACP 会话，但没有本地 transcript 文件。
角色设定在 provider 内注入，任何入口派遣都一致。宿主没有 `subagents` 服务时，工具回退为直接调用
ACP，行为不变但不出现在编队中。

## 首字超时

一次派遣如果 **30 秒**内没有任何流式输出：取消 ACP 会话 → SIGTERM → 1.5 秒后 SIGKILL → 返回错误。
窗口可用插件配置 `firstChunkMs` 调整。

## 工作原理

```
DSH Agent
  └─ ask_claude(task)
       └─ ctx.subagents.start('claude')        ← 编队可见
            └─ ACP 客户端 (lib/acp.mjs)
                 └─ @agentclientprotocol/claude-agent-acp  (子进程)
                      └─ claude CLI → 你的模型后端
```

子进程只拿到任务文本（含角色前缀），不继承父会话历史；每次调用都是全新进程。

## 排障

| 现象 | 原因与处理 |
|---|---|
| 面板显示 `Failed to fetch` | 宿主半没起来：通常是依赖或安装方式问题。确认用 `dsh plugin add` 安装并重启 |
| 安装后没有侧栏入口 | 重启 DSH；确认没有手写进 `cordis.patch.yml` |
| 开关打开但模型看不到工具 | 适配器未安装，或 CLI 探测失败；展开看状态 |
| 适配器安装失败 | 看面板里的 npm 退出码与日志尾部；网络或权限问题 |
| 派遣返回 5xx | 是 CLI 背后的模型后端问题（例如中转站无可用账号），不是插件 |
| 编队里看不到子 agent | 宿主需提供 `subagents` 服务；另外远程子 agent 无本地会话文件 |
| 保存后界面没变化 | 点的是固定按钮；若标题栏没有「处理中…」，说明点击未到达，检查是否有遮挡 |

## 安全

- 页面只绑 `127.0.0.1` 且没有鉴权，不要把端口暴露出去。
- 你在页面上填的任意可执行路径都会被启动，只指向你信任的程序。
- 适配器发来的权限请求会被自动批准（选第一个 allow 选项）。

## 限制

- **远程子 agent 没有本地 transcript**：编队可见，但点开可能没有对话记录。
- **单轮无状态**：调用之间没有多轮记忆，上下文要写进任务文本。
- **只在 macOS arm64 上测过**：代码处理了 Windows `PATHEXT`，适配器统一用 `node <js>` 启动，
  其他平台没有实机验证。
- **装好适配器后约 770MB**：两家平台二进制，按需安装，装一次即可。
- **无法强制模型调用**：工具是否被选择由模型决定，只能通过提示词或常驻指令引导。

## 文件结构

```
index.js          宿主半：配置、探测、provider/工具注册、页面服务
lib/agents.mjs    Agent 策略表、PATH 探测、适配器解析与安装命令
lib/acp.mjs       ACP 客户端（零依赖 JSON-RPC）
lib/personas.mjs  角色文档读写与默认值
lib/store.mjs     配置读写
lib/server.mjs    本地页面与 /api
lib/client.js     浏览器半：侧栏入口与面板
public/index.html 独立页面
serve.mjs         不依赖 DSH 的预览启动器
```

## 开发

```sh
node serve.mjs          # 只起页面，不需要 DSH 宿主，方便调 UI
node --check index.js   # 语法检查
```

## 许可证

[MIT](LICENSE)
