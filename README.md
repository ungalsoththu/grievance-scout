# Grievance Scout

**Continuous monitoring of public service grievances on social media**

Grievance Scout is a scalable, passive auditing platform that tracks citizen complaints to public service organizations on Twitter/X. It automatically discovers new complaint patterns, analyzes response times, and generates actionable audit reports.

## Quick Start

```bash
cd /home/workspace/Skills/grievance-scout
bun install
bun run scripts/init.ts  # Initialize database
bun run scripts/audit.ts --handle @MtcChennai
```

## What It Does

1. **Monitors** - Watches Twitter/X handles for incoming complaints
2. **Tracks** - Records all complaints and official responses
3. **Discovers** - Extracts new search terms (routes, stops, keywords) from existing data
4. **Analyzes** - Categorizes complaints, measures response times, identifies escalations
5. **Reports** - Generates weekly audit summaries with metrics

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

## Key Features

| Feature | Description |
|---------|-------------|
| **Passive Querying** | Rotates search terms, adds jitter, stays under rate limits |
| **Term Discovery** | Automatically extracts routes, stops, keywords from existing data |
| **Historical Backfill** | Overcomes 7-day search limit through time-sliced queries |
| **Pluggable Backends** | SQLite (local), Turso (distributed) |
| **Multi-Handle** | Monitor any number of service accounts |
| **Escalation Detection** | Identifies frustrated users and unresolved issues |

## Usage

### Standalone (Any Server)

```bash
cd /home/workspace/Skills/grievance-scout

# Quick audit
bun run scripts/audit.ts

# Agent mode with reports
bun run scripts/audit.ts --agent-mode

# Backfill 90 days
bun run scripts/backfill.ts --handle mtc-chennai --days 90
```

### Zo Agent (Scheduled Weekly)

A scheduled agent runs every Sunday at 9 AM IST:

```bash
# Agent ID: [created in Zo]
# Runs: bun run scripts/audit.ts --agent-mode --email-report
```

## Configuration

### Add a New Handle

Edit `config/handles.json`:

```json
{
  "handles": [{
    "id": "my-transport",
    "handle": "@MyTransportCo",
    "name": "My Transport Co",
    "city": "Mumbai",
    "isActive": true,
    "categories": ["route_issue", "delay", "staff_behavior"],
    "escalationRules": {
      "noResponseHours": 48,
      "repeatComplaintThreshold": 3
    }
  }]
}
```

### Switch to Turso (Distributed)

```json
// config/db.config.json
{
  "activeAdapter": "turso",
  "turso": {
    "url": "libsql://my-db.turso.io",
    "authToken": "${TURSO_AUTH_TOKEN}"
  }
}
```

## Scripts

| Script | Purpose |
|--------|---------|
| `init.ts` | Initialize database with default search terms |
| `audit.ts` | Run audit - fetch and analyze |
| `enrich-terms.ts` | Discover new routes/stops/keywords from existing data |
| `backfill.ts` | Recover historical data (overcomes 7-day limit) |

## Database Schema

```sql
handles          - Configured accounts to monitor
complaints       - All tweets TO monitored handles
responses        - All tweets FROM monitored handles
search_terms     - Discovered routes, stops, keywords
reports          - Generated weekly audit reports
```

## Querying Data

```bash
# This week's complaints
sqlite3 Data/grievance-scout/audit.db \
  "SELECT * FROM complaints 
   WHERE posted_at >= date('now', 'weekday 1', '-7 days')"

# Average response time by category
sqlite3 Data/grievance-scout/audit.db \
  "SELECT category, AVG(response_time_minutes)/60 as avg_hours 
   FROM complaints 
   WHERE status IN ('responded', 'resolved') 
   GROUP BY category"

# Unresolved escalations
sqlite3 Data/grievance-scout/audit.db \
  "SELECT * FROM complaints 
   WHERE is_escalated = 1 AND status = 'pending'"
```

## Scaling

### Add More Handles

Add to `config/handles.json`. The passive rotator will automatically cycle through all handles.

### Term Enrichment

As data grows, the system discovers new search terms:

```bash
bun run scripts/enrich-terms.ts
```

This finds patterns like `23B`, `T Nagar`, `overcrowded` and adds them as new search queries.

### Distributed Setup

Multiple instances can share a Turso database for distributed monitoring.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TWITTER_AUTH_TOKEN` | Twitter auth from browser cookies |
| `TWITTER_CT0` | Twitter CT0 from browser cookies |
| `AUDIT_DB_PATH` | Database path (default: `Data/grievance-scout/audit.db`) |
| `TURSO_AUTH_TOKEN` | Required for Turso backend |
| `ZO_CLIENT_IDENTITY_TOKEN` | Enables LLM categorization (optional) |

## Project Structure

```
grievance-scout/
├── src/
│   ├── db/              # Database adapters
│   ├── search/          # Twitter client, rotator, term discovery
│   ├── classify/        # LLM categorizer
│   └── report/          # Report generators
├── scripts/
│   ├── audit.ts         # Main audit script
│   ├── init.ts          # Initialization
│   ├── enrich-terms.ts  # Term discovery
│   └── backfill.ts      # Historical backfill
├── config/
│   ├── handles.json     # Monitored handles
│   └── db.config.json   # Database settings
├── assets/templates/    # Report templates
└── README.md
```

## License

MIT - Created for Zo Computer by ungalsoththu.zo.computer
