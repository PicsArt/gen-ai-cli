---
name: install-gen-ai-cli-and-mcp
description: Install the Picsart gen-ai CLI AND wire up the MCP server for Claude Code, Codex, Cursor, VS Code, Windsurf, ChatGPT (Agents), or any MCP-compatible host. Trigger this skill whenever the user asks to install gen-ai, set up the Picsart MCP, connect their agent to Picsart, register an MCP server, get started with gen-ai, hit "command not found: gen-ai", or run their first generation. Also trigger when a skill references gen-ai but the user hasn't installed or authenticated yet.
---

# Install gen-ai CLI & MCP

**Two ways to use gen-ai:**

1. **CLI** — `gen-ai <command>` in the terminal. Best for scripting, CI, cron, piping.
2. **MCP** — `@picsart/gen-ai-mcp` exposes every capability to your agent (Claude Code, Codex, Cursor, Windsurf, ChatGPT) as native tool calls. Best when you want to stay inside your AI tool and ask in plain English.

You can install just the MCP if you never plan to use a terminal — the MCP server runs its own binary and doesn't require the CLI to be installed. Most users end up with both.

## Auto-trigger

Activate this skill on any of these phrases (natural language):

- "install gen-ai", "install picsart cli"
- "set up the MCP", "add gen-ai to Claude Code / Codex / Cursor / VS Code / Windsurf / ChatGPT"
- "connect my agent to Picsart", "wire Picsart into my IDE"
- "first-run setup", "get started with gen-ai"
- `gen-ai: command not found`
- `MCP tool not available`
- Any time the user is about to run `gen-ai generate` or call `gen-ai_generate` but isn't authenticated yet

## Decision: CLI, MCP, or both?

| Situation | Install |
|---|---|
| User works in a terminal / scripts / CI | CLI (+ MCP if they also use an AI IDE) |
| User lives in Claude Code / Codex / Cursor / Windsurf / ChatGPT | MCP (skip CLI) |
| User wants both terminal + IDE workflows | Both |
| User asks "how do I generate?" and there's no context | Ask where they work, then install accordingly |

## Step 1 — Install the CLI (optional if MCP-only)

Pick the platform the user is on. Default to the shell installer.

```bash
# macOS / Linux
curl -fsSL https://picsart.com/gen-ai-cli/install.sh | bash

# Windows (PowerShell)
iwr -useb https://picsart.com/gen-ai-cli/install.ps1 | iex

# npm (Node 22+ already present)
npm install -g @picsart/gen-ai
```

**Verify:**

```bash
gen-ai --version
```

If "command not found", restart the shell or `source` the profile the installer wrote to. On macOS/Linux, the installer adds `~/.gen-ai/bin` to the PATH via `~/.zshrc` / `~/.bashrc`.

## Step 2 — Authenticate

```bash
gen-ai login
```

Opens OAuth in the browser. After:

```bash
gen-ai whoami
```

Must return an email and a non-expired token. If expired, re-run `gen-ai login`.

**For CI / headless**: set the auth environment variables before running the CLI:

```bash
export PICSART_ACCESS_TOKEN="<token from picsart.com/developer-console>"
export PICSART_USER_ID="<picsart-user-id>"
gen-ai whoami
```

## Step 3 — Install the MCP server

```bash
npm i -g @picsart/gen-ai-mcp
```

The MCP server is a standalone binary — it runs its own process and exposes tools to the agent. It uses the same auth as the CLI (via `~/.gen-ai/credentials` or `PICSART_TOKEN`).

### MCP-only install (no CLI needed)

If the user lives inside an AI IDE and never wants a terminal CLI:

```bash
npm i -g @picsart/gen-ai-mcp
```

Authenticate by setting `PICSART_TOKEN` in the agent's env config (see per-host instructions below). No `gen-ai login` needed.

## Step 4 — Register with the agent the user is using

### Claude Code / Codex

Both support `claude mcp add` and `codex mcp add` respectively. They share the same MCP protocol, so the server registration is identical:

```bash
# Claude Code
claude mcp add gen-ai-mcp -- gen-ai-mcp

# Codex (OpenAI CLI)
codex mcp add gen-ai-mcp -- gen-ai-mcp
```

Or ask the agent in chat:

> *"Add @picsart/gen-ai-mcp as an MCP server. Then run gen-ai_whoami to confirm auth."*

### Cursor — `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "gen-ai-mcp": {
      "command": "gen-ai-mcp",
      "env": { "PICSART_TOKEN": "..." }
    }
  }
}
```

### VS Code Copilot — `.vscode/mcp.json`

```json
{
  "servers": {
    "gen-ai-mcp": {
      "command": "gen-ai-mcp",
      "env": { "PICSART_TOKEN": "..." }
    }
  }
}
```

### Windsurf — `~/.codeium/windsurf/mcp_config.json`

```json
{
  "mcpServers": {
    "gen-ai-mcp": {
      "command": "gen-ai-mcp",
      "env": { "PICSART_TOKEN": "..." }
    }
  }
}
```

### ChatGPT (Agents / custom connectors)

Add as a custom connector pointing at the `gen-ai-mcp` binary (locally or via a hosted proxy). Pass `PICSART_TOKEN` via env.

### Zapier / n8n / Make

All three support MCP servers as tool providers. Point them at the `gen-ai-mcp` binary (or a container that runs it) and pass `PICSART_TOKEN` via env.

### Any MCP-compatible host

The server speaks standard MCP. It exposes these tools:

- `gen-ai_generate` — image / video / audio generation
- `gen-ai_batch` — manifest-driven batch runs
- `gen-ai_extend` — extend videos
- `gen-ai_list_models` — enumerate available models
- `gen-ai_model_info` — inspect a specific model (voices, params, cost)
- `gen-ai_compare_models` — render the same prompt across N models
- `gen-ai_estimate` — dry-run cost check before spend
- `gen-ai_pricing` — live per-call cost for a model
- `gen-ai_history` — list past generations (for audit / A/B)
- `gen-ai_login` / `gen-ai_whoami` — auth scoped to the user's account

## Step 5 — Verify with a cheap generation

Use **Recraft V4** (2 credits, ~$0.02):

```bash
gen-ai generate -m recraft-v4 -p "a single smoke test sphere" --ar 1:1 \
  --json --no-input | jq -r '.url' | xargs curl -L -o test.webp
```

Or, from inside the agent (natural language):

> *"Generate a 1:1 test image with recraft-v4 and save it to ./test.webp."*

The agent should call `gen-ai_generate` natively. If it doesn't, re-check the MCP registration and restart the IDE/host.

## Step 6 — Sensible defaults

```bash
gen-ai config set defaultModel recraft-v4      # cheap, fast default
gen-ai config set autoOpen true                 # open outputs automatically
gen-ai completion zsh >> ~/.zshrc               # tab completion
gen-ai config set downloadDir "$HOME/Downloads" # absolute local download dir
```

## Step 7 — Set up brand guidance (optional but recommended)

If the repo has a `brand.md` with palette, typography, voice, and forbidden patterns:

Read it before generation and include the relevant constraints in prompts or prompt files. The current CLI does not have a default rules config or policy gate flag.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `command not found: gen-ai` | Restart shell or `source ~/.zshrc` |
| `401 Unauthorized` | `gen-ai login` — token expired |
| `402 Insufficient credits` | Top up at picsart.com/developer-console |
| MCP not visible in agent | Check `.cursor/mcp.json` / `.vscode/mcp.json` path; restart the IDE |
| MCP server crashes on start | Confirm Node 22+; check `PICSART_TOKEN` env is set |
| `gen-ai update` fails mid-batch | Never run `update` during a batch — it restarts the binary. Let the batch finish |
| `Node version error` | Install Node 22+ (required engine) |
| `429 rate-limited` | Lower `--concurrency` to 2 and rerun failed jobs with `gen-ai batch resume <output-dir>` |
| Mac Gatekeeper blocks the binary | `xattr -d com.apple.quarantine $(which gen-ai)` — signed release coming |
| Fresh clone, new dev machine | Run `gen-ai login` again; auth is per-machine |

## Fully headless setup (CI / Docker)

```dockerfile
# Dockerfile
FROM node:22-alpine
RUN npm i -g @picsart/gen-ai @picsart/gen-ai-mcp
ENV PICSART_TOKEN=""
CMD ["gen-ai", "--help"]
```

```yaml
# GitHub Actions
- run: npm i -g @picsart/gen-ai
- run: gen-ai whoami
  env:
    PICSART_ACCESS_TOKEN: ${{ secrets.PICSART_ACCESS_TOKEN }}
    PICSART_USER_ID: ${{ secrets.PICSART_USER_ID }}
- run: gen-ai whoami
```

## For agents

- **Before the first `gen-ai generate` call (or `gen-ai_generate` MCP tool) in a session**, run `gen-ai whoami`. If it fails, stop and ask the user to run `gen-ai login` — agents cannot complete OAuth on their own.
- **If the user is in an MCP-enabled host and the CLI isn't installed**, don't insist on installing the CLI — use the MCP server directly.
- **Never run `gen-ai update` mid-batch** — it restarts the binary and kills in-flight jobs.
- **Default model for verification**: `recraft-v4` — 2 credits is a cheap smoke test.
- **After successful install**, offer to use `brand.md` as prompt context if one exists in the repo.
- **For CI / headless**, set `PICSART_ACCESS_TOKEN` and `PICSART_USER_ID`, then run `gen-ai whoami` — never interactive OAuth.
