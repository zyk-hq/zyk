# Zyk Demo Script — Production Incident Response
**Target:** ~2 min Reddit video
**Story:** "Payment service is down. Watch Zyk handle the entire incident — from alert to resolution — without writing a single line of code."

---

## Before You Hit Record

### 1. Start the stack
```bash
docker compose up -d
```

### 2. Start ngrok (Slack needs a public URL to send button clicks)
```bash
ngrok http 3100
```
Copy the `https://` forwarding URL (e.g. `https://abc123.ngrok-free.app`).

### 3. Configure Slack app interactivity
Go to **api.slack.com → Your App → Interactivity & Shortcuts**
Set **Request URL** to: `https://abc123.ngrok-free.app/slack/interactions`
Save.

### 4. Set STATUS_INTERVAL_MS for a fast demo
In `claude_desktop_config.json` (or `.mcp.json`), add to `env`:
```json
"STATUS_INTERVAL_MS": "30000"
```
This makes the status update prompt appear after 30 seconds instead of 2 minutes.
Restart Claude Desktop after saving.

### 5. Reset state
- Make sure no leftover workflows: ask Claude "List my workflows" → delete any old ones
- Open [http://localhost:3100](http://localhost:3100) in a browser — leave it visible
- Open Slack — go to the channel you'll be paged in
- Open GitHub repo — leave it visible in a tab

---

## Recording Layout (split screen recommended)
```
┌─────────────────────┬─────────────────────┐
│  Claude Desktop     │  Zyk UI :3100        │
│  (left half)        │  (right half)        │
├─────────────────────┴─────────────────────┤
│  Slack (lower left)   GitHub (lower right) │
└───────────────────────────────────────────┘
```

---

## The Script

### [0:00 – 0:15] Hook
> *(Show blank Claude Desktop)*
**Type:** `Create a production incident response workflow. When triggered it should:`
`- Create a GitHub issue`
`- Create a dedicated Slack channel and page the on-call engineer`
`- Ask them to acknowledge, escalate, or mark as false alarm`
`- If SEV1, broadcast a deploy freeze to #engineering, alert #leadership and #support in parallel`
`- Send status update prompts every 30 minutes until resolved`
`- Close the GitHub issue with resolution details`

---

### [0:15 – 0:45] Workflow Created
> *(Watch Claude call `create_workflow` — no typing needed, just show the response)*

Claude returns something like:
```
✅ Workflow "production-incident-response" registered.
Worker started and connected to Hatchet.
```

> *(Cut to Zyk UI at localhost:3100 — the workflow card appears with the Mermaid diagram)*
**Voiceover/caption:** *"Workflow registered. Worker running. Zero config."*

---

### [0:45 – 1:00] Trigger the Incident
> *(Back in Claude Desktop)*
**Type:** `Trigger the incident response workflow — payment service is down, sev1, checkout API returning 503, source: Datadog`

> *(Claude calls `run_workflow`)*
> *(Cut to Hatchet UI at localhost:8081 — show the run starting, steps lighting up)*

---

### [1:00 – 1:20] GitHub + Slack fire instantly
> *(Split screen: GitHub tab + Slack)*

Show in quick succession:
- GitHub issue appears: `[SEV1] Payment service is down`
- Slack: new channel `#inc-sev1-payment-service-is-down` created
- Slack: alert message with ✅ Acknowledge / ⬆️ Escalate / 🔕 False Alarm buttons

**Caption:** *"GitHub issue. Slack channel. On-call paged. All in ~5 seconds."*

---

### [1:20 – 1:35] Acknowledge + SEV1
> *(In Slack, click **✅ Acknowledge**)*
> *(Severity prompt appears — click **🔴 SEV1 — Critical**)*

> *(Cut to Slack — show 3 notifications firing almost simultaneously)*
- `#engineering` — 🚨 SEV1 INCIDENT — DEPLOY FREEZE IN EFFECT
- `#leadership` — 🚨 SEV1 INCIDENT ALERT
- `#support` — 🚨 SEV1 — CUSTOMER IMPACT EXPECTED

**Caption:** *"Parallel broadcasts. No if/else spaghetti. Just works."*

---

### [1:35 – 1:50] Status Update → Resolve
> *(~30 seconds later, status update prompt appears in Slack)*
> *(Click **✅ Resolved**)*

> *(Cut to GitHub — issue gets a comment then closes)*
> *(Cut to Slack — resolved message appears in incident channel)*

**Caption:** *"Issue closed. Team notified. Audit trail in GitHub."*

---

### [1:50 – 2:00] Zyk UI closeout
> *(Show localhost:3100 — workflow card with diagram)*
> *(Show Hatchet UI at localhost:8081 — all steps green)*

**Final caption / voiceover:**
*"Describe it. Watch it build. Deploy it."*
*"Zyk — workflow automation for teams that live in Claude."*

---

## Key talking points for the Reddit post

- **No code written** — Claude generated the full TypeScript from a description
- **Real durability** — powered by Hatchet, not a one-shot LLM call. Survives crashes, retries failures
- **Real APIs** — not simulated. Actual GitHub issues, actual Slack channels, actual button interactions
- **Any workflow** — same conversation interface works for cron jobs, webhooks, approval flows, anything
- **Self-hosted** — one `docker compose up`, your data stays local

---

## Env vars needed in Claude Desktop config

```json
"env": {
  "HATCHET_CLIENT_TOKEN": "...",
  "HATCHET_HOST_PORT": "localhost:7077",
  "SLACK_BOT_TOKEN": "xoxb-...",
  "SLACK_SIGNING_SECRET": "...",
  "GITHUB_TOKEN": "ghp_...",
  "GITHUB_REPO": "owner/repo",
  "ONCALL_USER": "U0XXXXXXX",
  "ENGINEERING_CHANNEL": "C0XXXXXXX",
  "LEADERSHIP_CHANNEL": "C0XXXXXXX",
  "SUPPORT_CHANNEL": "C0XXXXXXX",
  "STATUS_INTERVAL_MS": "30000"
}
```

---

## Troubleshooting

**Slack buttons don't work**
→ Check ngrok is running and the Request URL in your Slack app matches `https://<ngrok-url>/slack/interactions`
→ Verify `SLACK_SIGNING_SECRET` is set correctly — the server validates every request

**Worker fails to start**
→ Check `docker compose ps` — hatchet-engine must be healthy
→ Check `HATCHET_CLIENT_TOKEN` is the current token

**Status update never appears**
→ Confirm `STATUS_INTERVAL_MS` is set (e.g. `"30000"`) in the MCP server env

**Channel already exists error**
→ Previous demo left a channel with the same name. Archive it in Slack or use a different incident title.
