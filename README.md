# dsh-acp-agent-bridge

[English](README.md) | [简体中文](README.zh-CN.md)

A DeepSeek Harness plugin that turns locally installed coding-agent CLIs into ACP-dispatched
tools. It detects Claude Code and Codex on your machine, exposes each one behind a switch,
and lets the agent delegate a self-contained task to it over the
[Agent Client Protocol](https://agentclientprotocol.com/).

![Configuration page](docs/preview.png)

## Features

- **Auto-detection with manual fallback** — scans `PATH` and verifies `<cli> --version`; if a CLI
  is installed somewhere unusual, type its absolute path on the page and it re-probes immediately.
- **Per-agent switch** — a disabled agent registers no tool at all; the model never sees it.
- **ACP dispatch** — each delegation spawns the CLI's ACP adapter, runs one `initialize` →
  `newSession` → `prompt` cycle, and returns the final answer. No shell scraping, no `--print` parsing.
- **CLI-identified results** — tools are named `ask_claude` / `ask_codex`, so a transcript shows
  exactly which agent did the work.
- **Strategy registry** — adding another CLI is one entry in `lib/agents.mjs`.

## Requirements

| Requirement | Notes |
|---|---|
| DeepSeek Harness | The host. The plugin uses only `ctx.tools`, `ctx.effect`, `ctx.logger`. |
| Claude Code CLI | Optional. Must be installed and logged in to use `ask_claude`. |
| Codex CLI | Optional. Must be installed and logged in to use `ask_codex`. |
| Node.js | Not needed separately — adapters start on the host's own Node. |
| ACP adapters | Installed with this package; no runtime download. |

## Install

```sh
# from npm (once published)
dsh plugin --profile desktop add dsh-acp-agent-bridge

# or straight from GitHub
dsh plugin --profile desktop add github:yalepi966-png/dsh-acp-agent-bridge
```

The package declares `dsh.bundle.patch`, so the plugin row is inserted into the profile
automatically — you do not edit `cordis.patch.yml` by hand. Restart DeepSeek Harness afterwards.

## Usage

1. Open `http://127.0.0.1:4319` (if the port is busy the plugin picks another one; the real URL is
   printed in the log and returned by the `agent_bridge_status` tool).
2. Check the status badge. `Unavailable` shows the reason — fill in the CLI path if detection failed.
3. Flip the switch on for the agents you want, then **Save**.
4. Ask the agent to delegate, or call the tool directly:

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
| `port` | Page port; 0 picks a free port, and a busy port falls back automatically. |
| `enabled` | The switch. Off means no tool is registered. |
| `command` | CLI path. Empty means "detect by name on `PATH`". |
| `adapterCommand` / `adapterArgs` | Override the ACP adapter. Empty means "use the bundled adapter". |

## Adding another CLI

Edit `lib/agents.mjs`:

```js
{
  id: 'gemini',                          // also the tool suffix: ask_gemini
  label: 'Gemini CLI',
  bin: 'gemini',
  adapter: { package: '@agentclientprotocol/gemini-acp', bin: 'gemini-acp' },
}
```

Detection, registration, the page, and dispatch all pick it up. The CLI needs an ACP adapter;
this plugin intentionally has no "raw CLI" fallback, so there is only one dispatch semantics.

## How it works

```
DSH agent
  └─ ask_claude(task)
       └─ ACP client (lib/acp.mjs)
            └─ @agentclientprotocol/claude-agent-acp   (spawned)
                 └─ claude CLI → your model backend
```

The child gets the task text only. No conversation history crosses the boundary, and each call is
a fresh process.

## Security

- The page binds `127.0.0.1` and has no authentication. Do not expose the port.
- Whatever executable path you type on the page will be spawned. Only point it at software you trust.
- Permission requests from the adapter are answered automatically (first "allow" option).

## Limitations

- **Tool-level delegation** — the work happens in a child process, not a DSH child session in the
  session tree. A real `SubagentProvider` is the next step.
- **Single turn** — no multi-turn memory between calls; put the context in the task text.
- **Tested on macOS arm64 only** — the code handles Windows `PATHEXT` and starts adapters through
  `node <js>`, but other platforms have not been verified.
- **~770 MB install** — almost entirely the two vendors' platform binaries. Move the adapters to
  `optionalDependencies` if you prefer `npx` on first use.

## Development

```sh
node serve.mjs          # page only, no DSH host, for UI work
node --check index.js   # syntax
```

## License

[MIT](LICENSE)
