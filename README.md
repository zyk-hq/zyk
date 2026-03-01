# Zyk — Conversational Workflow Automation

**Describe it. Watch it build. Deploy it.**

Zyk lets you build durable workflow automations through conversation with Claude. Describe what you want in plain English, Claude writes real TypeScript, and Zyk runs it on [Hatchet](https://hatchet.run) — a durable execution engine that handles retries, scheduling, and failure recovery.

No visual builder. No connector library. No YAML. Just conversation.

> **⚠️ Early development — not yet alpha.** Zyk is under active development and not ready for production use. Expect rough edges, breaking changes, and missing features. Feedback and issues are very welcome.

**Try it without any setup → [zyk.dev](https://zyk.dev)**
The playground runs pre-configured workflows in your browser. No Docker, no API keys, no local install needed.

**Stay in the loop** — subscribe for updates at [blog.zyk.dev](https://blog.zyk.dev) or reach out directly at [hello@zyk.dev](mailto:hello@zyk.dev).

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) + Docker Compose
- [Node.js 20+](https://nodejs.org/) — **on Windows, install natively (not inside WSL)**
- [Claude Desktop](https://claude.ai/download) or [Claude Code](https://claude.ai/code)

> **Windows users:** clone the repo on your Windows filesystem (e.g. `C:\Users\you\zyk-mcp`), not inside WSL. Claude Desktop runs as a Windows process and can't reach WSL paths.

---

## Setup

### Option A — One-command bootstrap (recommended)

Clone the repo, then run one script. It starts Hatchet, generates an API token automatically, builds the MCP server, and configures Claude Desktop.

**macOS / Linux / Git Bash:**

```bash
git clone https://github.com/zyk-hq/zyk
cd zyk
./scripts/bootstrap.sh
```

**Windows (PowerShell):**

```powershell
git clone https://github.com/zyk-hq/zyk
cd zyk
.\scripts\bootstrap.ps1
```

Then **fully quit and restart Claude Desktop** (tray icon → Quit, then reopen). Ask Claude: *"List my workflows"* — you should see a confirmation that no workflows are registered yet.

---

### Option B — npm (no clone needed)

If you have Docker running and just want the MCP server without cloning:

```bash
# 1. Download and start the infrastructure
curl -O https://raw.githubusercontent.com/zyk-hq/zyk/main/docker-compose.yml

# 2. Start Hatchet (see "Get a Hatchet token" below for the token step)
docker compose up postgres hatchet-engine -d

# 3. Configure Claude Desktop — run setup and follow the prompts
npx -y zyk-mcp setup
```

Then add `npx -y zyk-mcp` as your MCP server command (the setup script writes this automatically).

---

### Option C — Manual setup

<details>
<summary>Expand for step-by-step manual instructions</summary>

#### 1. Clone, install, and build

```bash
git clone https://github.com/zyk-hq/zyk
cd zyk/mcp-server
npm install
npm run build
```

#### 2. Start Hatchet and Postgres

```bash
docker compose up postgres hatchet-engine -d
docker compose ps   # wait until hatchet-engine shows "healthy" (~30s)
```

#### 3. Get a Hatchet API token

```bash
node scripts/generate-token.js
```

This logs into Hatchet via the REST API and prints a token for your tenant. Copy the printed token.

> **Alternative:** open [http://localhost:8888](http://localhost:8888) (login: `admin@example.com` / `Admin123!!`), go to **Settings → API Tokens**, and create a token there.

#### 4. Configure environment

```bash
cp .env.example .env
# Open .env and set HATCHET_CLIENT_TOKEN=<your token>
```

#### 5. Connect Claude to Zyk

**Claude Desktop** — run the setup script:

```bash
cd zyk/mcp-server
node setup.js
```

It auto-detects your OS and Claude Desktop install type and writes the config.

**Manual Claude Desktop config:**

| Platform | Config path |
|----------|-------------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows (installer) | `%APPDATA%\Roaming\Claude\claude_desktop_config.json` |
| Windows (Store) | `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json` |

> **Windows Store users:** `%APPDATA%\Roaming\Claude\` is silently ignored — use the `Packages\…` path above.

```json
{
  "mcpServers": {
    "zyk": {
      "command": "node",
      "args": ["C:\\Users\\you\\zyk-mcp\\mcp-server\\dist\\index.js"],
      "env": {
        "HATCHET_CLIENT_TOKEN": "your-token-here",
        "HATCHET_CLIENT_HOST_PORT": "localhost:7077",
        "HATCHET_CLIENT_TLS_STRATEGY": "none"
      }
    }
  }
}
```

**Claude Code (CLI)** — the `.mcp.json` in this repo is pre-configured. Just set your token:

```bash
# Set HATCHET_CLIENT_TOKEN in your shell or in .mcp.json, then:
claude
```

</details>

---

## Testing locally

### Step 1: Verify the connection

In Claude, ask:

> "List my workflows"

You should get back:

```
No workflows registered yet. Use create_workflow to create your first workflow.
```

If you see a tool error instead, check [Troubleshooting](#troubleshooting).

---

### Step 2: Create a test workflow (no API keys needed)

This workflow just logs a message — it has no external dependencies, so it's perfect for verifying the full stack.

Tell Claude:

> "Create a simple test workflow called 'hello-world' that logs a greeting message with a timestamp and returns it. Make it manually triggered."

Claude will generate something like this and call `create_workflow`:

```typescript
import { Hatchet } from "@hatchet-dev/typescript-sdk";

const hatchet = Hatchet.init();

const workflow = hatchet.workflow({ name: "hello-world" });

workflow.task({
  name: "greet",
  retries: 3,
  fn: async (_input, ctx) => {
    const message = `Hello, world! It is ${new Date().toISOString()}`;
    await ctx.log(message);
    return { message };
  },
});

const worker = await hatchet.worker("hello-world-worker", {
  workflows: [workflow],
});

export default { start: () => worker.start() };
```

A successful response looks like:

```json
{
  "success": true,
  "workflow_id": "wf-a1b2c3d4",
  "name": "hello-world",
  "trigger": "on-demand",
  "message": "Workflow \"hello-world\" registered and worker started successfully."
}
```

**What just happened:**
1. Claude generated the TypeScript code
2. Zyk saved it to `workflows/wf-a1b2c3d4.ts`
3. Zyk forked a child process to run it
4. The child connected to Hatchet via gRPC on port 7077
5. The worker is now polling Hatchet for jobs

---

### Step 3: Run the workflow

Tell Claude:

> "Run the hello-world workflow with name='Zyk'"

Or directly:

> "Run workflow wf-a1b2c3d4 with params {\"name\": \"Zyk\"}"

You'll get back a `run_id`:

```json
{
  "success": true,
  "run_id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Workflow triggered successfully."
}
```

---

### Step 4: Check the status

Tell Claude:

> "Check the status of that run"

Or pass the run_id explicitly:

> "get_status for workflow wf-a1b2c3d4, run 550e8400-..."

---

### Step 5: Verify in the Hatchet UI

Open [http://localhost:8888](http://localhost:8888) and go to **Workflows** or **Runs**.

You should see:
- The `hello-world` workflow registered
- A completed run with the output `{ message: "Hello, Zyk! It is 2026-..." }`

The Hatchet UI gives you full visibility into every run, every step, retries, and timing — without building any dashboard yourself.

**Hatchet concepts at a glance:**
- **Workflow** — the blueprint: a named set of tasks with their order, dependencies, and retry policy
- **Worker** — the running process that executes a workflow. Zyk spawns one worker subprocess per workflow; each worker connects to Hatchet via gRPC and waits for work
- **Run** — a single execution of a workflow. Created when you trigger it manually or on schedule

---

### Step 6: Test the webhook receiver

If you create a webhook-triggered workflow, you can trigger it with `curl`:

```bash
# First, create a webhook-triggered workflow and note its ID
# Then trigger it:
curl -X POST http://localhost:3100/webhook/wf-a1b2c3d4 \
  -H "Content-Type: application/json" \
  -d '{"name": "webhook caller"}'
```

Response:

```json
{
  "success": true,
  "workflow_id": "wf-a1b2c3d4",
  "workflow_name": "hello-world",
  "run_id": "..."
}
```

You can also trigger any manually-triggered workflow this way — the webhook receiver works for all registered workflows.

---

### Step 7: Update the workflow

Tell Claude:

> "Update the hello-world workflow to also log the current Node.js version"

Claude will call `update_workflow` with new code. The worker restarts automatically. The workflow ID is preserved — existing references still work.

---

### Step 8: Clean up

Tell Claude:

> "Delete the hello-world workflow"

This stops the worker process, removes the code file, and removes it from the registry.

---

## Troubleshooting

### "HATCHET_CLIENT_TOKEN is not set"

The env var isn't reaching the MCP server process. In Claude Desktop, make sure `HATCHET_CLIENT_TOKEN` is in the `env` block of `claude_desktop_config.json` (not just in your shell). Restart Claude Desktop after changes.

### Tools don't appear in Claude Desktop

- Confirm the `args` path is **absolute** and uses the correct slash style for your OS
- **Windows:** make sure you're editing the right config file (see table in step 5). If you installed from the **Windows Store**, the `%APPDATA%\Roaming\Claude\` path is silently ignored — use the `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\` path instead.
- Test the server manually: run `node path/to/dist/index.js` in a terminal — it should print `Zyk MCP server running on stdio` and hang (waiting on stdin). That's correct.
- Check Claude Desktop MCP logs:
  - **macOS:** `~/Library/Logs/Claude/mcp-server-zyk.log`
  - **Windows (installer):** `%APPDATA%\Roaming\Claude\logs\mcp-server-zyk.log`
  - **Windows (Store):** `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\logs\mcp-server-zyk.log`

### "Worker failed to start" on create_workflow

The worker subprocess couldn't connect to Hatchet. Check:

```bash
# Is Hatchet running?
docker compose ps

# Can the MCP server reach Hatchet gRPC?
nc -zv localhost 7077
```

Also check that `HATCHET_HOST_PORT` is set correctly. Default for local dev: `localhost:7077`.

### Workflow runs appear in Hatchet under a different tenant

The token was generated for a different tenant than the one you're viewing. Regenerate:

```bash
node scripts/generate-token.js
```

Then update `HATCHET_CLIENT_TOKEN` in `.env`, `.mcp.json`, and `claude_desktop_config.json`.

### Hatchet dashboard shows the workflow but no runs

The worker registered but the run trigger failed. Check:
- The workflow name in the code matches exactly the `name` passed to `create_workflow`
- There are no TypeScript errors in the generated code (Claude should flag these)

### Worker crashes immediately after create_workflow

Check the MCP server's stderr output. In Claude Code, this appears in the terminal. In Claude Desktop, check the logs directory:

- **macOS:** `~/Library/Logs/Claude/`
- **Windows (installer):** `%APPDATA%\Roaming\Claude\logs\`
- **Windows (Store):** `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\logs\`

### Hatchet isn't reachable after Docker restart

Hatchet needs Postgres to be healthy first. Give it 30 seconds:

```bash
docker compose restart hatchet-engine
docker compose logs -f hatchet-engine
```

### "Cannot find package 'tsx'" in worker

`tsx` must be installed in `mcp-server/node_modules`. Run:

```bash
cd mcp-server && npm install
```

---

## Adding secrets for real workflows

When creating a workflow that calls external APIs (Slack, Stripe, etc.), you need to pass the relevant secrets through to the MCP server process.

**Claude Desktop** — add to the `env` block:

```json
{
  "mcpServers": {
    "zyk": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/index.js"],
      "env": {
        "HATCHET_CLIENT_TOKEN": "...",
        "SLACK_BOT_TOKEN": "xoxb-...",
        "STRIPE_SECRET_KEY": "sk_live_..."
      }
    }
  }
}
```

**Claude Code** — add to `.mcp.json`'s `env` block, or set them in your shell before launching `claude` (child processes inherit the shell environment).

Generated workflow code accesses them via `process.env.SLACK_TOKEN` etc. — they're available in worker subprocesses automatically because workers inherit the MCP server's environment.

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `create_workflow` | Generate and register a new durable workflow |
| `update_workflow` | Update code/config and restart the worker, preserving the ID |
| `run_workflow` | Trigger a workflow execution |
| `get_status` | Check the status of a workflow or a specific run |
| `list_workflows` | See all registered workflows and their worker status |
| `delete_workflow` | Remove a workflow and stop its worker |
| `list_templates` | Browse pre-built workflow templates _(requires `ZYK_API_KEY`)_ |
| `use_template` | Pull a template's full code ready to deploy _(requires `ZYK_API_KEY`)_ |
| `review_workflow` | AI-assisted code quality review _(requires `ZYK_API_KEY`)_ |

Webhook trigger (no Claude required):

```
POST http://localhost:3100/webhook/<workflow_id>
Content-Type: application/json

{ ...your params... }
```

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HATCHET_CLIENT_TOKEN` | Yes | — | API token from Hatchet dashboard |
| `HATCHET_HOST_PORT` | No | `localhost:7077` | Hatchet gRPC address |
| `WEBHOOK_PORT` | No | `3100` | Port for the webhook HTTP receiver |
| `SLACK_BOT_TOKEN` | No | — | Passed through to workflow subprocesses |
| `STRIPE_SECRET_KEY` | No | — | Passed through to workflow subprocesses |
| `GITHUB_TOKEN` | No | — | Passed through to workflow subprocesses |

Any env var set on the MCP server process is available in generated workflows via `process.env`.

---

## Example workflows

See [`examples/`](./examples):

| File | What it does | Trigger | Requires |
|------|-------------|---------|----------|
| [`daily-revenue-report.ts`](./examples/daily-revenue-report.ts) | Fetch Stripe revenue → post to Slack | Schedule (8 AM daily) | `STRIPE_SECRET_KEY`, `SLACK_TOKEN` |
| [`new-user-onboarding.ts`](./examples/new-user-onboarding.ts) | Welcome email + Notion page + Slack notification on signup | Webhook | `RESEND_API_KEY`, `NOTION_TOKEN`, `SLACK_TOKEN` |
| [`api-error-monitor.ts`](./examples/api-error-monitor.ts) | Poll API health → PagerDuty + Slack on failure | Schedule (every 5 min) | `API_HEALTH_URL`, `PAGERDUTY_ROUTING_KEY`, `SLACK_TOKEN` |

To use an example, paste its code into a conversation and ask Claude to register it:

> "Register this workflow code: [paste contents of examples/api-error-monitor.ts]"

---

## How it works

```
You (natural language)
    ↓
Claude Desktop / Claude Code
    ↓  MCP protocol over stdio
Zyk MCP Server
    ├── workflows/registry.json   persisted workflow registry
    └── (fork per workflow)
        Worker Subprocess  →  tsx transpiles .ts at runtime
            ↓  gRPC
        Hatchet Engine  (Docker :8888 UI, :8080 API, :7077 gRPC)
            ↓
        PostgreSQL  (Docker)
```

---

## vs. Zapier / n8n / Make

| | Zapier/Make | n8n | **Zyk** |
|---|---|---|---|
| Interface | Visual UI | Visual UI | **Conversation** |
| Connectors | Pre-built only | Pre-built only | **Any API Claude knows** |
| Durability | Basic | Basic | **Yes (Hatchet)** |
| Self-host | Limited | Yes | **One command** |
| Custom logic | Limited | Limited | **Full TypeScript** |

---

## License

MIT
