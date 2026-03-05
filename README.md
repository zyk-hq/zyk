# Zyk — Open-Source Workflow Automation

**Describe it. Run it. Done.**

We're betting on two things: **MCP-ready AI as the interface** for building and running workflows, and **durable execution as the engine** for making them reliable. Zyk is what happens when you combine them.

You describe a workflow in plain English through Claude. Zyk generates structured TypeScript and runs it on a durable execution engine. Retries, scheduling, and error handling built in by design.

No connectors to configure. No DSL to learn. Just describe it — the diagram builds itself.

**What durable means in practice:** a workflow can fire on a Slack message, create a GitHub issue, post Acknowledge/Escalate buttons back to Slack, and wait hours for a human to respond — then resume and close the loop automatically. No split endpoints, no manual state management.

**Builders describe and manage workflows through Claude.** Participants can respond through whatever interface the workflow surfaces — Slack, email, or directly through Claude. Different permissions, same underlying engine.

Open source, self-hostable, or use Zyk Cloud. The generated code lives in your repo.

> **🚧 Not released yet.** Zyk is not publicly available yet — we're getting close. [Subscribe at blog.zyk.dev](https://blog.zyk.dev) to be notified when it launches.

**Try it without any setup → [zyk.dev](https://zyk.dev)**
The playground runs pre-configured workflows in your browser. No Docker, no API keys, no local install needed.

**Stay in the loop** — subscribe at [blog.zyk.dev](https://blog.zyk.dev) or reach out at [hello@zyk.dev](mailto:hello@zyk.dev).

---

## Why this stack

**Claude** is becoming the daily interface for knowledge workers. Instead of building a separate UI, Zyk plugs into it — builders describe automations in conversation, Claude generates the code, Zyk deploys it. No new tool to learn.

**Hatchet over Temporal?** Single Docker image (Hatchet Lite), Postgres-only dependency, no Kafka or Cassandra, beautiful built-in monitoring UI. Temporal is powerful but complex to self-host. Hatchet is one `docker compose up`. That matters for small teams.

**Real TypeScript over a DSL.** Previous automation tools lock you into their connector library. If the connector doesn't exist, you're blocked. Claude knows thousands of APIs from training — it writes the HTTP calls directly. No connector maintenance, no limitations.

**Durable execution over serverless functions.** Serverless functions have hard execution timeouts — typically 10–15 minutes. That's fine for a webhook handler, but it makes human-in-the-loop workflows impossible to build correctly. If your workflow posts an approval request to Slack and needs to wait hours for a response, a Lambda times out before the human clicks anything. You end up splitting the workflow into separate functions wired together with queues and external state — which you now have to manage yourself. Hatchet workflows are long-running processes: they can pause mid-execution, wait indefinitely for a human signal, and resume exactly where they left off. No queues, no external state store, no split endpoints.

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) + Docker Compose
- [Node.js 20+](https://nodejs.org/) — **on Windows, install natively (not inside WSL)**
- [Claude](https://claude.ai/download)

> **Windows users:** clone the repo on your Windows filesystem (e.g. `C:\Users\you\zyk-mcp`), not inside WSL. Claude runs as a Windows process and can't reach WSL paths.

---

## Setup

### Option A — One-command bootstrap (recommended)

Clone the repo, then run one script. It starts Hatchet, generates an API token automatically, builds the MCP server, and configures Claude.

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

Then **fully quit and restart Claude** (tray icon → Quit, then reopen). Ask Claude: *"List my workflows"* — you should see a confirmation that no workflows are registered yet.

---

### Option B — npm (no clone needed)

If you have Docker running and just want the MCP server without cloning:

```bash
# 1. Download and start the infrastructure
curl -O https://raw.githubusercontent.com/zyk-hq/zyk/main/docker-compose.yml

# 2. Start Hatchet (see "Get a Hatchet token" below for the token step)
docker compose up postgres hatchet-engine -d

# 3. Configure Claude — run setup and follow the prompts
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

**Claude** — run the setup script:

```bash
cd zyk/mcp-server
node setup.js
```

It auto-detects your OS and Claude install type and writes the config.

**Manual Claude config:**

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

---

### Step 5: Verify in the Hatchet UI

Open [http://localhost:8888](http://localhost:8888) and go to **Workflows** or **Runs**.

You should see:
- The `hello-world` workflow registered
- A completed run with the output `{ message: "Hello, Zyk! It is 2026-..." }`

The Hatchet UI gives you full visibility into every run, every step, retries, and timing.

**Hatchet concepts at a glance:**
- **Workflow** — a named set of tasks with their order, dependencies, and retry policy
- **Worker** — the running process that executes a workflow. Zyk spawns one worker subprocess per workflow; each connects to Hatchet via gRPC and waits for work
- **Run** — a single execution of a workflow

---

### Step 6: Test the webhook receiver

Trigger any workflow from outside Claude:

```bash
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

---

### Step 7: Update the workflow

Tell Claude:

> "Update the hello-world workflow to also log the current Node.js version"

Claude calls `update_workflow` with new code. The worker restarts automatically. The workflow ID is preserved.

---

### Step 8: Clean up

Tell Claude:

> "Delete the hello-world workflow"

This stops the worker process, removes the code file, and removes it from the registry.

---

## How it works

```
You (natural language)
    ↓
Claude
    ↓  MCP protocol over stdio
Zyk MCP Server
    ├── workflows/registry.json   persisted workflow registry
    └── (one subprocess per workflow)
        Worker  →  esbuild compiles .ts at deploy time
            ↓  gRPC
        Hatchet Engine  (Docker :8888 UI, :8080 REST, :7077 gRPC)
            ↓
        PostgreSQL  (run history, scheduling)
```

**Worker lifecycle:** each worker forks as a child process, sends a `ready` handshake once connected to Hatchet, and auto-restarts on crash with exponential backoff (1s → 2s → 4s → … → 60s, max 5 retries). Workers are restored automatically when the MCP server restarts.

**Scheduling:** cron expressions live inside the workflow code (`on: { cron: "0 8 * * *" }`). Hatchet owns scheduling entirely — it reads the cron from the registered workflow and fires runs on time.

**Slack interactions:** workflows post a message with buttons, set `block_id` to a `correlationId`, then poll `GET /slack/pending/:correlationId` every 3 seconds. When a user clicks a button, Zyk's webhook server receives the Slack interaction, stores the result, and the polling loop picks it up. No external event system needed.

---

## Known limitations

- **Single-user/single-team.** All workflows share one Hatchet tenant. No auth, no per-user namespacing. Multi-tenant isolation is future work.
- **Slack interaction state is in-memory.** If the MCP server restarts while a workflow is waiting for a Slack button click, that pending state is lost.
- **No code sandboxing.** Generated workflows run with full Node.js permissions and inherit the MCP server's environment variables. This is the right tradeoff for self-hosted single-user use; it's not appropriate for untrusted multi-user environments.
- **Webhook receiver is unauthenticated.** `POST /webhook/:id` accepts requests from anywhere. For local dev this is fine; for public deployment, put it behind a reverse proxy with auth.

---

## Troubleshooting

### "HATCHET_CLIENT_TOKEN is not set"

The env var isn't reaching the MCP server process. In Claude, make sure `HATCHET_CLIENT_TOKEN` is in the `env` block of `claude_desktop_config.json` (not just in your shell). Restart Claude after changes.

### Tools don't appear in Claude

- Confirm the `args` path is **absolute** and uses the correct slash style for your OS
- **Windows:** make sure you're editing the right config file (see table above). If you installed from the **Windows Store**, the `%APPDATA%\Roaming\Claude\` path is silently ignored — use the `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\` path instead.
- Test the server manually: run `node path/to/dist/index.js` in a terminal — it should print `Zyk MCP server running on stdio` and hang. That's correct.
- Check Claude MCP logs:
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

### Workflow runs appear in Hatchet under a different tenant

The token was generated for a different tenant than the one you're viewing. Regenerate:

```bash
node scripts/generate-token.js
```

Then update `HATCHET_CLIENT_TOKEN` in `.env`, `.mcp.json`, and `claude_desktop_config.json`.

### Worker crashes immediately after create_workflow

Check the MCP server's stderr output. In Claude Code, this appears in the terminal. In Claude, check the logs directory:

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

```bash
cd mcp-server && npm install
```

---

## Adding secrets for real workflows

**Claude** — add to the `env` block in `claude_desktop_config.json`:

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

**Claude Code** — add to `.mcp.json`'s `env` block, or set them in your shell before launching `claude`.

Generated workflow code accesses them via `process.env.SLACK_BOT_TOKEN` etc. — workers inherit the MCP server's environment automatically.

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
| [`daily-revenue-report.ts`](./examples/daily-revenue-report.ts) | Fetch Stripe revenue → post to Slack | Schedule (8 AM daily) | `STRIPE_SECRET_KEY`, `SLACK_BOT_TOKEN` |
| [`new-user-onboarding.ts`](./examples/new-user-onboarding.ts) | Welcome email + Notion page + Slack notification on signup | Webhook | `RESEND_API_KEY`, `NOTION_TOKEN`, `SLACK_BOT_TOKEN` |
| [`api-error-monitor.ts`](./examples/api-error-monitor.ts) | Poll API health → PagerDuty + Slack on failure | Schedule (every 5 min) | `API_HEALTH_URL`, `PAGERDUTY_ROUTING_KEY`, `SLACK_BOT_TOKEN` |

To use an example, paste its code into a conversation and ask Claude to register it:

> "Register this workflow code: [paste contents of examples/api-error-monitor.ts]"

---

## vs. Zapier / n8n / Make / Temporal

| | Zapier/Make | n8n | Serverless functions | Temporal | **Zyk** |
|---|---|---|---|---|---|
| Interface | Visual UI | Visual UI | Code | Code | **Conversation** |
| Connectors | Pre-built only | Pre-built only | DIY | DIY | **Any API Claude knows** |
| Durability | Basic | Basic | No (timeout-bound) | Yes | **Yes (Hatchet)** |
| Human-in-the-loop | Workarounds | Workarounds | Requires split architecture | Yes | **Yes — wait days if needed** |
| Self-host | Limited | Yes | Cloud-only | Complex | **One command** |
| Custom logic | Limited | Limited | Full code | Full code | **Full TypeScript** |

**Human-in-the-loop is where serverless breaks down.** A workflow that sends an approval request and waits for a human response can't run inside a single serverless function — it times out. The common workaround is splitting the workflow across multiple functions connected by a queue, with external state to track where you were. That split architecture is exactly the complexity that durable execution eliminates: the workflow is one continuous process that pauses, waits as long as needed, and resumes.

---

## License

MIT
