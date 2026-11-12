# dsh-acp-agent-bridge

[English](README.en.md) | [简体中文](README.md)

A DeepSeek Harness plugin that turns locally installed coding-agent CLIs into ACP-dispatched
subagents. It detects Claude Code and Codex, exposes each behind a switch, and lets the agent hand a
self-contained task to either of them.

![Configuration page](docs/preview.png)

---

## Page design

**Two entry points, one config**:

- the **Agent Bridge** row at the bottom of the DSH sidebar (browser half `lib/client.js`)
- the standalone page `http://127.0.0.1:4319` (host half `lib/server.mjs`)

**Top to bottom**:

| Region | Content |
|---|---|
| Sticky header | Title, enabled summary (`已启用 N 个：ask_claude、ask_codex`), **Save**, **Re-probe** |
| Port card | Port input, **Check**, **Confirm**; changing it rebinds the page service in place |
| Agent accordion | Each row: role tag + CLI name, status chip, switch, expand arrow |

**Interaction rules**:

- **The first agent starts expanded**, one open at a time; click a row header to expand or collapse.
- The expanded body uses a tinted background and holds: status sentence, persona file path, CLI path,
  adapter state with an **Install** button, role tag, role definition with a `chars / 2000` counter.
- **Save is pinned to the top-right**, outside the scrolling content, and applies to the currently
  expanded agent. A green `✓ 保存成功，下一次派遣立即生效` toast confirms; failures show in red with
  the reason.
- Three states only: `可以使用` (green), `已关闭` (grey), `不可用` (red). A missing adapter shows
  `待装适配器` separately instead of pretending to be usable.
- Look: frosted-glass cards, pale gradient background, low saturation; 12.5px base type, single
  column below 640px.

---

## Functional baseline

| Capability | Behavior | Status |
|---|---|---|
| CLI auto-detection | `PATH` scan + `--version`; resolved path filled into the input | Verified |
| Manual CLI path | Absolute path saved, re-probed; "auto" resets it | Verified |
| Per-agent switch | Off registers no tool; on + save exposes it to the model | Verified |
| ACP dispatch | `initialize → newSession → prompt → stream` | Verified |
| Subagent dispatch | Goes through `ctx.subagents.start()`; roster shows a child agent | Implemented, UI acceptance pending |
| On-demand adapter install | Panel **Install** runs the pinned npm install in the background | Verified (33s) |
| Version pinning | Claude `0.106.0`, Codex `2.6.0`; not user-selectable | Verified |
| Role tag | ≤10 chars; affects the tool description and display | Verified |
| Role definition | Markdown file, injected per dispatch; ≤2000 chars | Verified |
| Role hot reload | File re-read on every dispatch; edits apply next call | Verified |
| First-token timeout | 30s without output cancels the session and kills the process | Verified |
| Port configuration | Check availability → confirm → rebind in place | Verified |
| Save feedback | Pinned top-right button + floating success toast | Verified |
| Zero runtime dependencies | Built-in ACP transport; no npm `dependencies` | Verified |
| Cross-platform probing | Windows `PATHEXT`; adapters started as `node <js>` | macOS-tested only |

---

## Design thinking

### Why ACP instead of calling the CLI directly

`claude -p` yields a block of text, not structured streaming, permission requests, or a session
model. ACP is the standard between editors and agents; the adapter translates the CLI's tools,
permissions, and streaming into it, so the plugin only implements a small protocol slice. The cost is
one extra adapter process.

### Why implement the ACP client ourselves

The official SDK adds an npm dependency. When a package is installed via a local `link:` (a git clone
added by path), the package manager does **not** install that directory's dependencies — the host half
crashes on import, which surfaces as "the panel opens but the API fails with Failed to fetch". The
protocol surface used here is small (`initialize` / `session/new` / `session/prompt` /
`session/cancel` plus `session/update` notifications and `session/request_permission` requests), so
it is implemented in ~60 lines on Node built-ins, giving zero dependencies and working from any
install source.

### Why adapters are still required, and installed on demand

Claude Code and Codex do not speak ACP; the official adapters are the bridge and cannot be replaced by
us. They are large (~770 MB of platform binaries), so they are not package dependencies: the panel's
Install button puts a pinned version under `~/.dsh/agent-bridge/adapters`. The package itself stays a
few megabytes.

### Why a SubagentProvider instead of only a tool

A tool call is just a function execution; the DSH roster shows nothing. Registering a
`SubagentProvider` routes dispatch through `ctx.subagents.start()`, so DSH emits child lifecycle
events, the roster lists an independent subagent, and cancellation/reclamation share one contract.
The tool remains as the model-facing entry point.

### Why roles live in files

Role definitions are content you iterate on. Keeping them in `config.json` would make the config
unreadable and uneditable. One Markdown file per agent (with a `tag` front-matter block) is re-read on
every dispatch — hot by construction — and works as a plain task prefix, so no adapter needs
system-prompt support.

### Why Save is pinned

A button inside the content flow scrolls out of view. A fixed action bar keeps submission reachable;
because only one agent is expanded at a time, "save" is never ambiguous.

---

## Requirements

| Requirement | Notes |
|---|---|
| DeepSeek Harness | The host; the plugin uses `ctx.tools`, `ctx.subagents`, `ctx.effect`, `ctx.logger`. |
| Claude Code CLI | Optional; install and log in to use `ask_claude`. |
| Codex CLI | Optional; install and log in to use `ask_codex`. |
| Node.js | Not needed separately — adapters start on the host's own Node. |
| ACP adapters | Installed on demand from the panel; versions pinned inside the plugin. |
| npm dependencies | **None at runtime** — the ACP transport is built in, so git and local installs need no extra packages. |

## Install

```sh
# from npm (once published)
dsh plugin --profile desktop add dsh-acp-agent-bridge

# or straight from GitHub
dsh plugin --profile desktop add github:yalepi966-png/dsh-acp-agent-bridge
```

The package declares `dsh.bundle.patch`, so `dsh plugin add` inserts the plugin row automatically —
you do not edit `cordis.patch.yml` by hand. Restart DeepSeek Harness afterwards.

> **Install it as a bundle, not by hand.** Adding the row manually to the profile's
> `cordis.patch.yml` registers the host tools but **not** the sidebar entry: the client module
> registry only composes browser bundles for profile-bundle layers. `dsh plugin add` is the supported
> path.

## Usage

1. Open the panel from the sidebar row **Agent Bridge**, or open `http://127.0.0.1:4319`.
2. Expand an agent: check status, confirm the path, install the adapter if needed.
3. Turn the switch on, press **Save** (top-right).
4. Ask the model to delegate, or call the tool directly:

```
ask_claude: "Review src/server.mjs for concurrency bugs and reply with a numbered list."
```

## Configuration

The page writes `~/.dsh/agent-bridge/config.json`:

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

| Field | Meaning |
|---|---|
| `port` | Page port; a busy port falls back automatically |
| `enabled` | The switch; off registers no tool |
| `command` | CLI path; empty means detect by name on `PATH` |
| `adapterCommand` / `adapterArgs` | Override the adapter; empty uses the on-demand install |

> Legacy `label` / `persona` fields in `config.json` are ignored; personas files are authoritative.

### Changing the port

Enter a port → **Check** (a real bind attempt) → **Confirm**. Confirm saves the value and rebinds the
page service in place — no application restart. The panel follows the new URL; a browser tab opened on
the old port must be reopened.

## Adding another CLI

Edit `lib/agents.mjs`:

```js
{
  id: 'gemini',
  label: 'Gemini CLI',
  bin: 'gemini',
  adapter: { package: '@agentclientprotocol/gemini-acp', bin: 'gemini-acp', version: '1.0.0' },
}
```

Detection, registration, the page, and dispatch all follow. The CLI needs an ACP adapter; there is no
raw-CLI fallback, so only one dispatch semantics exists.

## Role tag and role definition

One Markdown file per agent:

```
~/.dsh/agent-bridge/personas/claude.md
~/.dsh/agent-bridge/personas/codex.md
```

```markdown
---
tag: Reviewer
---
You are the reviewer. Report problems only...
```

Defaults are seeded on first start:

| Agent | Default tag |
|---|---|
| Claude Code | Creative lead |
| Codex | Reviewer |

The definition is prepended to every task:

```
【Role】You are "Reviewer".
<body>

【Task】
<caller task>
```

With no definition the task is sent unchanged.

## Adapters

Each agent card shows adapter state: `未安装` / `已安装 · version` / `自定义`. When missing, press
**Install**; the host runs the pinned npm install in the background into
`~/.dsh/agent-bridge/adapters`, then re-probes and registers. Until the adapter is ready the switch
does nothing and no tool is registered.

## Subagent dispatch

The plugin registers two SubagentProviders (`claude` / `codex`). Tool calls go through
`ctx.subagents.start(provider, …)`, so each delegation is a real subagent run, visible in the roster,
sharing the host's cancellation and reclamation contract.

The child is remote (`localAgent` empty): it owns a process and an ACP session but has no local
transcript file. Roles are injected inside the provider, so every entry point is consistent. Without
a `subagents` service the tool falls back to calling ACP directly — same behavior, no roster entry.

## First-token deadline

A delegation with no streamed output for **30 seconds** is aborted: ACP cancel → SIGTERM → SIGKILL
after 1.5s → error returned. The window is configurable via the plugin's `firstChunkMs`.

## How it works

```
DSH agent
  └─ ask_claude(task)
       └─ ctx.subagents.start('claude')          ← visible in the roster
            └─ ACP client (lib/acp.mjs)
                 └─ @agentclientprotocol/claude-agent-acp  (child process)
                      └─ claude CLI → your model backend
```

The child receives only the task text (with the role prefix); no parent history crosses the boundary,
and every call is a fresh process.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Panel shows `Failed to fetch` | Host half is down — usually deps or install method. Install with `dsh plugin add` and restart |
| No sidebar entry after install | Restart DSH; make sure the row was not hand-written into `cordis.patch.yml` |
| Switch on but the model lacks the tool | Adapter not installed, or CLI detection failed; expand the card |
| Adapter install fails | Check the npm exit code and log tail shown in the panel; network or permissions |
| Delegation returns 5xx | The model backend behind the CLI (e.g. a relay with no accounts), not the plugin |
| No child agent in the roster | The host must provide `subagents`; remote children have no local session file |
| Save seems to do nothing | The button is pinned; if the header never shows `处理中…`, the click is not reaching it — check for an overlay |

## Security

- The page binds `127.0.0.1` and has no authentication. Do not expose the port.
- Any executable path typed on the page will be spawned; only point it at software you trust.
- Permission requests from the adapter are auto-approved (first "allow" option).

## Limitations

- **Remote children have no local transcript**: visible in the roster, but opening one may show no
  conversation.
- **Single turn, stateless**: no multi-turn memory between calls; put context in the task text.
- **macOS arm64 tested only**: Windows `PATHEXT` and `node <js>` adapter startup are handled, but
  other platforms are unverified.
- **~770 MB with adapters installed**: vendor platform binaries, downloaded on demand once.
- **The model chooses the tool**: dispatch cannot be forced; guide it with prompts or standing
  instructions.

## Layout

```
index.js          host half: config, detection, provider/tool registration, page server
lib/agents.mjs    agent strategy table, PATH probing, adapter resolution and install command
lib/acp.mjs       ACP client (dependency-free JSON-RPC)
lib/personas.mjs  role document read/write and defaults
lib/store.mjs     config persistence
lib/server.mjs    local page and /api
lib/client.js     browser half: sidebar entry and panel
public/index.html standalone page
serve.mjs         preview launcher without DSH
```

## Development

```sh
node serve.mjs          # page only, no DSH host, for UI work
node --check index.js   # syntax
```

## License

[MIT](LICENSE)
