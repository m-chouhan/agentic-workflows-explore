# Risk Factor Agent — n8n Workflow

> **An n8n-based AI agent that monitors global financial news daily, reasons over geopolitical and industry events, and suggests risk weight updates. You approve all changes via Telegram before any DB write occurs.**

Blueprint source: `knowledge/Risk_factor_agent.pdf`

---

## Architecture

```
Schedule (3 AM daily)
  → Fetch feature_weights from Postgres
  → Load 14-day agent_memory context
  → Search Finnhub API for news per category
  → LLM (Gemini) reasons over news + memory → produces JSON diff
  → Telegram: send diff with ✅/❌ inline buttons
  → Wait for your approval (webhook)
  → Write approved changes to Postgres + log to agent_memory
```

**Stack:** n8n · Postgres · Finnhub API (free) · Google Gemini · Telegram Bot API  
**No Redis, no DBOS, no TypeScript** — pure n8n visual workflow.

---

## Quick Start

### 1. Prerequisites

- Docker Desktop running
- Accounts/keys for:
  - [Finnhub](https://finnhub.io) — free signup, copy your API key from the dashboard
  - Google Gemini — reuse your existing `GOOGLE_GENERATIVE_AI_API_KEY`
  - Telegram bot token (see setup below)

### 2. Create your Telegram Bot (5 minutes)

```
1. Open Telegram → search @BotFather → start chat
2. Send: /newbot
3. Follow prompts → give it a name (e.g. "Risk Factor Agent") and username
4. BotFather gives you a token like: 1234567890:ABCdefGHI...
5. Start a chat with your new bot (search its username, press Start)
6. Get your chat ID:
   curl https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
   Look for: "chat":{"id":123456789}  ← that number is your TELEGRAM_CHAT_ID
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env and fill in all values:
#   FINNHUB_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
```

### 4. Start the stack

```bash
docker compose up -d
```

- **n8n UI:** http://localhost:5678
- **Postgres:** localhost:5433 (user: riskagent, db: risk_factor)

The `db/schema.sql` and `db/seed.sql` files are auto-executed on first Postgres start.
Check the seed loaded: 
```bash
docker exec risk-agent-postgres psql -U riskagent -d risk_factor -c "SELECT feature, weight FROM feature_weights ORDER BY category;"
```

### 5. Stop the stack

```bash
docker compose down        # keeps data
docker compose down -v     # wipes volumes (fresh start)
```

---

## Building the Workflow in n8n

> Open http://localhost:5678 → Workflows → New Workflow → name it "Risk Factor Agent"

### Node 1 — Schedule Trigger

| Field | Value |
|---|---|
| Trigger | Schedule |
| Trigger Interval | Days |
| Days Between Triggers | 1 |
| Trigger at Hour | 3 |
| Trigger at Minute | 0 |

> 💡 For testing, change to "Minutes" → every 1 minute, then switch back.

---

### Node 2 — Fetch Feature Weights (Postgres)

Add a **Postgres** node.

**Credentials setup (first time):**
- Name: `Risk Factor DB`
- Host: `postgres` (Docker service name — n8n is on same Docker network)
- Port: `5432`
- Database: `risk_factor`
- User: `riskagent`
- Password: `riskagent_pass` (from your .env)
- SSL: disabled (local)

**Node config:**
| Field | Value |
|---|---|
| Operation | Execute Query |
| Query | `SELECT feature, category, weight, description FROM feature_weights ORDER BY category, feature;` |

Output: array of `{ feature, category, weight, description }` rows.

---

### Node 3 — Fetch 14-Day Memory (Postgres)

Add another **Postgres** node (same credentials).

| Field | Value |
|---|---|
| Operation | Execute Query |
| Query | `SELECT run_date, feature, news_summary, reasoning, suggested_weight, confidence, approved, approved_weight FROM agent_memory WHERE run_date >= CURRENT_DATE - INTERVAL '14 days' ORDER BY run_date DESC, feature;` |

Output: last 14 days of agent reasoning — fed into the LLM prompt as context.

---

### Node 4 — Merge Weights + Memory (Merge node)

Add a **Merge** node to combine outputs from Node 2 and Node 3.

| Field | Value |
|---|---|
| Mode | Append |

Both arrays will be available downstream in the Code node.

---

### Node 5 — Search News per Category (HTTP Request)

Add an **HTTP Request** node for Finnhub.

| Field | Value |
|---|---|
| Method | GET |
| URL | `https://finnhub.io/api/v1/news` |
| Query Parameters | `category` = `general`, `token` = `{{ $env.FINNHUB_API_KEY }}` |

> 💡 Finnhub `/news` endpoint returns the latest global market news (20–50 articles). For company-specific news, use `/company-news?symbol=AAPL&from=...&to=...`

**Add a second HTTP Request** for geopolitical/macro news:
- URL: `https://finnhub.io/api/v1/news?category=forex&token={{ $env.FINNHUB_API_KEY }}`

---

### Node 6 — Build LLM Prompt (Code node)

Add a **Code** node (JavaScript). This assembles the structured prompt from all upstream data.

```javascript
// Collect upstream data
const weights = $('Fetch Feature Weights').all().map(i => i.json);
const memory  = $('Fetch 14-Day Memory').all().map(i => i.json);
const generalNews = $('News - General').all().map(i => i.json);
const forexNews   = $('News - Forex').all().map(i => i.json);

// Summarise news (top 15 articles to stay within token limits)
const allNews = [...generalNews, ...forexNews]
  .slice(0, 15)
  .map(n => `• [${n.source}] ${n.headline} — ${n.summary || ''}`)
  .join('\n');

// Format current weights as JSON
const weightsJson = JSON.stringify(weights, null, 2);

// Format memory context (last 14 days)
const memoryContext = memory.length > 0
  ? memory.map(m =>
      `${m.run_date} | ${m.feature}: suggested ${m.suggested_weight} (${m.confidence}) | approved=${m.approved} | reason: ${m.reasoning}`
    ).join('\n')
  : 'No prior memory — this is the first run.';

// Build the prompt
const prompt = `You are a risk weight advisor for a financial risk assessment system.

SCALE: 0 = safest, 10 = riskiest.
RULE: Be conservative — suggest max ±2 change per cycle unless very high confidence.
RULE: Do not re-suggest a change already in memory unless significant new development justifies it.

## CURRENT FEATURE WEIGHTS
${weightsJson}

## AGENT MEMORY (last 14 days)
${memoryContext}

## TODAY'S NEWS
${allNews}

## YOUR TASK
Review the news and memory. For each feature where news suggests a risk change, output a JSON array.
Only include features where you have a clear reason to suggest a change.
Features with no relevant news should be omitted.

Output ONLY valid JSON in this exact format (no markdown, no explanation outside the array):
[
  {
    "feature": "country:UAE",
    "current_weight": 2,
    "proposed_weight": 3,
    "confidence": "medium",
    "reasoning": "One sentence explaining why.",
    "sources": ["https://..."]
  }
]

If no changes are warranted, output an empty array: []`;

return [{ json: { prompt, weights, memory, newsCount: allNews.split('\n').length } }];
```

---

### Node 7 — Call Gemini LLM (Google Gemini node)

Add a **Google Gemini** node (or use HTTP Request to call the Gemini API directly).

**Option A — n8n's built-in Google Gemini node:**
- Credentials: add `Google Gemini API` → paste your `GOOGLE_GENERATIVE_AI_API_KEY`
- Model: `gemini-2.5-flash`
- Prompt: `{{ $json.prompt }}`

**Option B — HTTP Request (more control):**
```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={{ $env.GOOGLE_GENERATIVE_AI_API_KEY }}
Body (JSON):
{
  "contents": [{ "parts": [{ "text": "{{ $json.prompt }}" }] }],
  "generationConfig": { "temperature": 0.2, "maxOutputTokens": 2048 }
}
```

Low temperature (0.2) = conservative, consistent suggestions.

---

### Node 8 — Parse LLM Response (Code node)

Add a **Code** node to extract and validate the JSON diff from the LLM output.

```javascript
// Get raw LLM text (adjust path based on which Gemini node you used)
const rawText = $input.first().json.text 
  ?? $input.first().json.candidates?.[0]?.content?.parts?.[0]?.text
  ?? '';

// Strip any markdown code fences the model might add
const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

let diff = [];
try {
  diff = JSON.parse(cleaned);
} catch (e) {
  // LLM returned invalid JSON — treat as no changes
  console.error('Failed to parse LLM output:', rawText);
  diff = [];
}

// Filter: only include valid entries with actual weight changes
const valid = diff.filter(d =>
  d.feature &&
  typeof d.current_weight === 'number' &&
  typeof d.proposed_weight === 'number' &&
  d.proposed_weight !== d.current_weight &&
  d.proposed_weight >= 0 &&
  d.proposed_weight <= 10 &&
  ['low', 'medium', 'high'].includes(d.confidence)
);

if (valid.length === 0) {
  return [{ json: { hasSuggestions: false, diff: [], message: 'No weight changes suggested today.' } }];
}

return [{ json: { hasSuggestions: true, diff: valid, count: valid.length } }];
```

---

### Node 9 — IF: Any Suggestions? (IF node)

Add an **IF** node to branch:

| Field | Value |
|---|---|
| Condition | `{{ $json.hasSuggestions }}` equals `true` |

- **True branch** → proceed to Telegram notification
- **False branch** → send a "nothing to review today" Telegram message and stop

---

### Node 10 — Format Telegram Message (Code node)

```javascript
const diff = $json.diff;

// Format a clean Telegram HTML message
let msg = `🔍 <b>Risk Factor Agent — Daily Update</b>\n`;
msg += `📅 ${new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}\n\n`;
msg += `<b>${diff.length} change(s) suggested:</b>\n\n`;

diff.forEach((d, i) => {
  const arrow = d.proposed_weight > d.current_weight ? '📈' : '📉';
  const badge = d.confidence === 'high' ? '🔴' : d.confidence === 'medium' ? '🟡' : '🟢';
  msg += `${i + 1}. ${arrow} <b>${d.feature}</b>\n`;
  msg += `   Weight: <code>${d.current_weight}</code> → <code>${d.proposed_weight}</code> ${badge} ${d.confidence}\n`;
  msg += `   <i>${d.reasoning}</i>\n\n`;
});

msg += `\nApprove or reject each suggestion in the next message.`;

return [{ json: { message: msg, diff } }];
```

---

### Node 11 — Send Telegram Notification (Telegram node)

Add a **Telegram** node.

**Credentials setup (first time):**
- Go to Credentials → New → Telegram API
- Paste your `TELEGRAM_BOT_TOKEN`

| Field | Value |
|---|---|
| Operation | Send Message |
| Chat ID | `{{ $env.TELEGRAM_CHAT_ID }}` |
| Text | `{{ $json.message }}` |
| Parse Mode | HTML |

---

### Node 12 — Send Approval Buttons (Telegram node)

Add another **Telegram** node — this sends each suggestion as a separate message with ✅/❌ inline keyboard buttons.

Use a **SplitInBatches** node before this to loop over `diff` items one by one.

| Field | Value |
|---|---|
| Operation | Send Message |
| Chat ID | `{{ $env.TELEGRAM_CHAT_ID }}` |
| Text | `Approve change for <b>{{ $json.feature }}</b>?\n{{ $json.current_weight }} → {{ $json.proposed_weight }}` |
| Parse Mode | HTML |
| Reply Markup | Inline Keyboard |

Inline Keyboard config (JSON):
```json
{
  "inline_keyboard": [[
    { "text": "✅ Approve", "callback_data": "approve:{{ $json.feature }}:{{ $json.proposed_weight }}" },
    { "text": "❌ Reject",  "callback_data": "reject:{{ $json.feature }}" }
  ]]
}
```

---

### Node 13 — Wait for Approval (Wait node)

Add a **Wait** node.

| Field | Value |
|---|---|
| Resume | On Webhook Call |
| Webhook Suffix | `risk-agent-approval` |

n8n generates a unique webhook URL. When the user taps a Telegram button, the Telegram Trigger node catches the `callback_query` and calls this webhook to resume the workflow.

> 💡 **How the approval loop works:**
> - Telegram Trigger (separate workflow) listens for button taps
> - Parses `callback_data` → `approve:country:UAE:3` or `reject:country:UAE`  
> - Calls the Wait node's resume webhook
> - Main workflow resumes with approved/rejected data

---

### Node 14 — Write Approved Changes (Postgres node)

For each approved item, run two queries:

**Query 1 — Update weight:**
```sql
UPDATE feature_weights 
SET weight = {{ $json.approved_weight }}, last_reviewed = CURRENT_DATE
WHERE feature = '{{ $json.feature }}';
```

**Query 2 — Log to agent_memory:**
```sql
INSERT INTO agent_memory 
  (run_date, feature, news_summary, news_sources, reasoning, suggested_weight, confidence, approved, approved_weight)
VALUES 
  (CURRENT_DATE, '{{ $json.feature }}', '{{ $json.news_summary }}', '{{ $json.sources_json }}', 
   '{{ $json.reasoning }}', {{ $json.proposed_weight }}, '{{ $json.confidence }}', true, {{ $json.approved_weight }});
```

**Query 3 — Changelog:**
```sql
INSERT INTO weight_changelog (feature, previous_weight, new_weight, news_source, run_date)
VALUES ('{{ $json.feature }}', {{ $json.current_weight }}, {{ $json.approved_weight }}, '{{ $json.sources[0] }}', CURRENT_DATE);
```

---

### Node 15 — Confirmation Telegram (Telegram node)

Send a final summary message:

```
✅ Done! Applied {{ $json.approvedCount }} change(s).
Memory updated. See you tomorrow at 3 AM.
```

---

## Workflow Summary (Node Map)

```
[Schedule] 
  → [Postgres: Fetch Weights]  ─┐
  → [Postgres: Fetch Memory]   ─┤→ [Merge] → [HTTP: Finnhub News x2]
                                           → [Code: Build Prompt]
                                           → [Gemini: LLM Reason]
                                           → [Code: Parse Diff]
                                           → [IF: hasSuggestions?]
                                                ↓ true
                                           [Code: Format Message]
                                           → [Telegram: Notify]
                                           → [SplitInBatches: per feature]
                                             → [Telegram: Approval Buttons]
                                             → [Wait: Webhook]
                                             → [Postgres: Update Weight]
                                             → [Postgres: Insert Memory]
                                             → [Postgres: Changelog]
                                           → [Telegram: Confirmation]
```

---

## DBOS vs n8n — Comparison Notes

| Aspect | DBOS (scanAndFix) | n8n (Risk Factor Agent) |
|---|---|---|
| **Language** | TypeScript | Visual nodes + JS Code nodes |
| **Durability** | Crash-safe replay, memoised steps | Best-effort (process restart = lost execution) |
| **HITL** | `DBOS.recv()` — durable wait | Wait node + Webhook — not crash-safe |
| **LLM integration** | Vercel AI SDK + Zod schemas | Built-in Gemini/OpenAI nodes |
| **DB access** | TypeScript pg client | Visual Postgres node (SQL in UI) |
| **Dev experience** | Code editor, TypeScript types | Drag-and-drop, visual debugging |
| **Debugging** | Console logs, DBOS UI | n8n execution log, node-by-node inspect |
| **Best for** | Long-running, crash-critical workflows | Rapid prototyping, integrations, approvals |

> **Key insight:** n8n excels at connecting things quickly. DBOS excels at guaranteeing they run correctly. The Risk Factor Agent is a good fit for n8n because it's daily-batch (not real-time critical) and the HITL pattern maps naturally to Telegram's inline buttons.

---

## Local Dev Tips

### Test without waiting for 3 AM
- Change Schedule Trigger to "Minutes → every 1 minute" during dev
- Or: manually execute the workflow from n8n UI (▶ button)

### Inspect Postgres directly
```bash
docker exec -it risk-agent-postgres psql -U riskagent -d risk_factor

# Check weights
SELECT feature, weight FROM feature_weights ORDER BY category;

# Check memory
SELECT run_date, feature, suggested_weight, approved FROM agent_memory ORDER BY run_date DESC;

# Check changelog
SELECT * FROM weight_changelog ORDER BY changed_at DESC;
```

### View n8n execution logs
- n8n UI → Executions (left sidebar) → click any execution → inspect each node's input/output

### ngrok for local Telegram webhooks
Telegram requires a public HTTPS URL to deliver webhook events to your local n8n instance.
```bash
# Install ngrok: https://ngrok.com/download
ngrok http 5678

# Copy the https URL (e.g. https://abc123.ngrok.io)
# Set in .env: WEBHOOK_URL=https://abc123.ngrok.io
# Restart: docker compose down && docker compose up -d
```

---

## Deploying to Contabo

The Contabo VPS (`62.171.183.99`) already runs the DBOS platform. n8n runs alongside it — separate Docker network, separate Postgres container, proxied by Nginx at `n8n.mchouhan.co.in`.

### GitHub Secrets required (in addition to existing ones)

| Secret | Value |
|---|---|
| `N8N_POSTGRES_PASSWORD` | Strong password for the risk_factor DB |
| `N8N_ENCRYPTION_KEY` | 32+ char random string: `openssl rand -hex 20` |
| `N8N_BASIC_AUTH_USER` | n8n UI login username (e.g. `admin`) |
| `N8N_BASIC_AUTH_PASSWORD` | n8n UI login password |
| `FINNHUB_API_KEY` | Your Finnhub API key |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID |

### One-time server setup

```bash
# 1. Deploy nginx config for n8n
scp cloud/nginx/n8n-mchouhan.conf root@62.171.183.99:/etc/nginx/sites-available/
ssh contabo-agentic "
  ln -sf /etc/nginx/sites-available/n8n-mchouhan.conf /etc/nginx/sites-enabled/
  nginx -t && systemctl reload nginx
"

# 2. Issue SSL certificate (requires DNS A record n8n.mchouhan.co.in → 62.171.183.99)
ssh contabo-agentic "certbot --nginx -d n8n.mchouhan.co.in"
```

### Deploy via CI/CD

Push to `main` with changes in `n8n-risk-agent/` — the `deploy-n8n.yml` workflow triggers automatically.

Or trigger manually: GitHub → Actions → "Deploy n8n Risk Agent to Contabo" → Run workflow.

### Deploy manually (without CI)

```bash
cd n8n-risk-agent

# Write prod .env (fill in real values)
cp .env.example .env
# Edit .env: set N8N_HOST=n8n.mchouhan.co.in, WEBHOOK_URL=https://n8n.mchouhan.co.in,
#   N8N_BASIC_AUTH_USER, N8N_BASIC_AUTH_PASSWORD, N8N_ENCRYPTION_KEY, and all API keys

mkdir -p ~/n8n-deploy
scp .env docker-compose.prod.yml root@62.171.183.99:~/n8n-deploy/
scp -r db/ root@62.171.183.99:~/n8n-deploy/

ssh contabo-agentic << 'EOF'
  mkdir -p /opt/n8n-risk-agent
  cp ~/n8n-deploy/.env /opt/n8n-risk-agent/.env
  cp ~/n8n-deploy/docker-compose.prod.yml /opt/n8n-risk-agent/
  cp -r ~/n8n-deploy/db /opt/n8n-risk-agent/
  cd /opt/n8n-risk-agent
  docker compose -f docker-compose.prod.yml pull
  docker compose -f docker-compose.prod.yml up -d
EOF
```

### Health check

```bash
curl https://n8n.mchouhan.co.in/healthz
```

**Ports:** n8n binds to `127.0.0.1:5679` — Nginx proxies it. Port 5679 is NOT opened in the firewall.

---

## File Structure

```
n8n-risk-agent/
├── docker-compose.yml          ← n8n + Postgres (local dev)
├── .env.example                ← copy to .env, fill in keys
├── .env                        ← gitignored
├── .gitignore
├── db/
│   ├── schema.sql              ← feature_weights, agent_memory, weight_changelog tables
│   └── seed.sql                ← 15 sample features with initial risk weights
└── README.md                   ← this file (workflow build guide)
```
