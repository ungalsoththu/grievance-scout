---
name: grievance-scout
description: Scalable, passive grievance monitoring system for social media. Tracks complaints to public service handles, analyzes response times, and generates audit reports. Configurable for any number of handles with pluggable database backends.
compatibility: Created for Zo Computer, runs standalone with bun
metadata:
  author: ungalsoththu.zo.computer
  version: 1.0.0
---
# Grievance Scout

A production-grade platform for monitoring and auditing public service grievances on social media. Designed to be portable, scalable, and non-intrusive through passive querying.

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Twitter/X API  │────▶│ Passive      │────▶│  SQLite/Turso   │
│  (bird CLI)     │     │ Rotator      │     │  Database       │
└─────────────────┘     └──────────────┘     └─────────────────┘
                               │                      │
                               ▼                      ▼
                        ┌──────────────┐     ┌─────────────────┐
                        │ Term         │     │ Weekly Reports  │
                        │ Discovery    │     │ & Dashboards    │
                        └──────────────┘     └─────────────────┘
```

## Features

- **Multi-handle support**: Monitor any number of Twitter/X handles
- **Passive querying**: Rotates search terms, adds jitter, stays under rate limits
- **Term discovery**: Automatically extracts routes, stops, keywords from existing data
- **Historical backfill**: Overcomes 7-day search limit through time-sliced searches
- **Pluggable backends**: SQLite (local), Turso (distributed), Postgres (future)
- **Categorization**: LLM-based or keyword-based complaint classification
- **Escalation detection**: Identifies frustrated users and unresolved issues

## Quick Start

### 1. Install Dependencies

```bash
cd /home/workspace/Skills/grievance-scout
bun install
```

### 2. Configure Twitter Auth

Set environment variables:

```bash
export TWITTER_AUTH_TOKEN="your_auth_token"
export TWITTER_CT0="your_ct0_token"
```

To get these, log into Twitter in a browser and extract from cookies.

### 3. Configure Handles

Edit `config/handles.json` to add handles you want to monitor:

```json
{
  "handles": [{
    "id": "mtc-chennai",
    "handle": "@MtcChennai",
    "name": "MTC Chennai",
    "isActive": true,
    "categories": ["route_issue", "delay", "staff_behavior"],
    "escalationRules": {
      "noResponseHours": 48,
      "escalationKeywords": ["not resolved", "ignored"]
    }
  }]
}
```

### 4. Run Audit

```bash
# Quick run (10 minutes)
bun run scripts/audit.ts

# Agent mode with reports (30 minutes)
bun run scripts/audit.ts --agent-mode

# Single handle
bun run scripts/audit.ts --handle @MtcChennai
```

## Usage Modes

### Standalone (Anywhere)

```bash
# Install bun
curl -fsSL https://bun.sh/install | bash

# Clone skill (or copy files)
git clone ...

# Run
bun run scripts/audit.ts --config config/handles.json
```

### Zo Agent (Scheduled)

Create a scheduled agent in Zo to run weekly:

```bash
bun run scripts/audit.ts --agent-mode --email-report
```

### As Zo Tool

```bash
cd /home/workspace/Skills/grievance-scout
bun run scripts/audit.ts --handle @MtcChennai
```

## Database

Default: SQLite at `Data/grievance-scout/audit.db`

Tables:
- `handles` - Configured accounts to monitor
- `complaints` - All tweets TO monitored handles
- `responses` - All tweets FROM monitored handles
- `search_terms` - Discovered routes, stops, keywords for expanded search
- `reports` - Generated weekly audit reports

### Switch to Turso

Edit database config:

```typescript
// In code or config
const adapter = await createAdapter({
  activeAdapter: 'turso',
  turso: {
    url: 'libsql://your-db.turso.io',
    authToken: process.env.TURSO_AUTH_TOKEN!
  }
});
```

## Term Discovery

The system automatically discovers new search terms:

```bash
# Extract routes, stops, keywords from existing data
bun run scripts/enrich-terms.ts --handle mtc-chennai
```

This finds patterns like:
- Route numbers: `23B`, `51D`, `M147`
- Stop names: `T Nagar Bus Stand`, `Central Railway Station`
- Frequent keywords: `overcrowded`, `late`, `rude driver`

These become new search queries, expanding coverage over time.

## Historical Backfill

Twitter's search API limits to ~7 days. To get older data:

```bash
# Backfill 90 days of historical data
bun run scripts/backfill.ts --handle mtc-chennai --days 90
```

This runs **passively**:
- Uses time-sliced queries: `since:2026-01-01 until:2026-01-07`
- Rotates through multiple search terms
- Long cooldowns between queries (30+ min for backfill)
- May take days to complete deep backfills

## Passive Querying Strategy

To avoid detection and blocking:

1. **Query rotation**: No fixed patterns, shuffled order
2. **Jitter**: Random delays (±30%) between requests
3. **Rate limiting**: Max 15 requests per 15-minute window
4. **Exponential backoff**: On failure, wait 2x, 4x, 8x...
5. **Priority tiers**:
   - P1 (mentions): 5 min interval
   - P2 (routes/stops): 15 min
   - P3 (keywords): 30 min
   - P4 (backfill): 2 hours

## Report Generation

Weekly reports generated automatically in `--agent-mode`:

```
Data/grievance-scout/reports/2026-W11/
├── MtcChennai.md
├── aggregate.md
└── charts/
    └── response-times.png
```

Report includes:
- Executive summary (complaints, response rate, avg time)
- Category breakdown
- Escalated issues
- Response time distribution
- Top unresolved complaints

## Querying the Database

```bash
# List complaints
duckdb Data/grievance-scout/audit.db -c "SELECT * FROM complaints LIMIT 10"

# Response stats
sqlite3 Data/grievance-scout/audit.db \
  "SELECT handle, COUNT(*), AVG(response_time_minutes)/60 as avg_hours 
   FROM complaints 
   WHERE status IN ('responded', 'resolved') 
   GROUP BY handle"

# Unresolved escalations
sqlite3 Data/grievance-scout/audit.db \
  "SELECT * FROM complaints 
   WHERE is_escalated = 1 
   AND status = 'pending' 
   ORDER BY posted_at"
```

## Scaling

### Add More Handles

Simply add to `config/handles.json`. The system rotates through all handles automatically.

### Database Sharding

For very large deployments:

```json
{
  "handles": [{
    "id": "mtc-chennai",
    "database": "regional-chennai.db"  // Per-handle DB
  }]
}
```

### Distributed Setup with Turso

```typescript
// config/db.config.json
{
  "active_adapter": "turso",
  "turso": {
    "url": "libsql://audit-db.turso.io",
    "auth_token": "${TURSO_AUTH_TOKEN}"
  }
}
```

Multiple instances can write to the same distributed database.

## Extending

### Add New Categories

Edit `handles.json` categories array. The LLM categorizer will use them automatically.

### Custom Classifier

Replace `LLMCategorizer` with your own:

```typescript
export class MyCategorizer {
  async categorize(complaint: Complaint, categories: string[]): Promise<CategorizationResult> {
    // Your logic here
  }
}
```

### Add Data Sources

Twitter is just one source. Add Facebook, Reddit, etc:

```typescript
// src/search/facebook-client.ts
export class FacebookClient {
  async search(pageId: string): Promise<Post[]> { ... }
}
```

## Troubleshooting

### bird CLI not found

```bash
npm install -g @steipete/bird
```

### Rate limited by Twitter

- The passive rotator handles this automatically
- Increase `jitterPercent` in config
- Reduce `maxRequestsPerWindow`

### No results found

- Verify Twitter auth tokens are valid
- Check handle spelling (case insensitive)
- Try manual search: `bird search "to:@MtcChennai"`

### Database locked

SQLite with WAL mode should handle concurrent access. If issues persist:

```bash
# Kill any hanging processes
lsof Data/grievance-scout/audit.db

# Repair database
sqlite3 Data/grievance-scout/audit.db ".recover" | sqlite3 audit-recovered.db
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TWITTER_AUTH_TOKEN` | Yes | Twitter auth token from browser cookies |
| `TWITTER_CT0` | Yes | Twitter CT0 token from browser cookies |
| `AUDIT_DB_PATH` | No | Database path (default: `Data/grievance-scout/audit.db`) |
| `TURSO_AUTH_TOKEN` | No* | Required if using Turso backend |
| `ZO_CLIENT_IDENTITY_TOKEN` | No | Enables LLM categorization via Zo API |

## Roadmap

**Current**: Phase 1 complete (Core Platform)
**Next**: Phase 2 (Intelligence) - LLM categorization, sentiment analysis

### Completed ✅
- SQLite database adapter
- Passive query rotator
- Handle/complaint/response storage
- Term discovery engine
- Weekly reporting
- Docker & CI/CD
- Test suite

### In Progress 🚧
- LLM categorization via Zo API
- Sentiment analysis
- Response quality scoring

### Planned 📋
- Turso distributed database
- Multi-source (Facebook, Reddit)
- REST API
- Telegram/Slack notifications
- Tamil/Hindi language support
- Predictive escalation alerts

## License

MIT - Created for Zo Computer by ungalsoththu.zo.computer
