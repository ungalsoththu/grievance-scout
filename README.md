# Grievance Scout

**Continuous monitoring of public service grievances on social media**

[![CI](https://github.com/ungalsoththu/grievance-scout/actions/workflows/ci.yml/badge.svg)](https://github.com/ungalsoththu/grievance-scout/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-10%20passing-brightgreen)](https://github.com/ungalsoththu/grievance-scout/blob/main/tests/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

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

## Deployment

### GitHub Actions (Recommended)

The repository includes scheduled workflows:

1. **Fork/clone this repo**
2. **Add repository secrets** (Settings → Secrets → Actions):
   - `TWITTER_AUTH_TOKEN` - From browser cookies
   - `TWITTER_CT0` - From browser cookies  
   - `ZO_CLIENT_IDENTITY_TOKEN` - Optional, for LLM categorization
   - `TURSO_AUTH_TOKEN` - Optional, for Turso backend

3. **Enable workflows** → Audit runs automatically every Sunday 9 AM IST

Workflows:
- `ci.yml` - Type check & test on every push
- `scheduled-audit.yml` - Weekly audit with artifact upload
- `release.yml` - Builds container image on tag push

### Docker

```bash
# Build
docker build -t grievance-scout .

# Run once
docker run -e TWITTER_AUTH_TOKEN=xxx -e TWITTER_CT0=xxx \
  -v $(pwd)/data:/data grievance-scout

# Run with custom command
docker run grievance-scout bun run scripts/audit.ts --handle @MtcChennai
```

### Docker Compose

```bash
# Create .env file
cat > .env << EOF
TWITTER_AUTH_TOKEN=your_token
TWITTER_CT0=your_ct0
EOF

# Start with scheduler
docker-compose up -d

# Run manually
docker-compose run grievance-scout bun run scripts/audit.ts --agent-mode

# View logs
docker-compose logs -f
```

### GitHub Container Registry

Pre-built images available:

```bash
docker pull ghcr.io/ungalsoththu/grievance-scout:latest

# Run
docker run -e TWITTER_AUTH_TOKEN=xxx -e TWITTER_CT0=xxx \
  -v $(pwd)/data:/data \
  ghcr.io/ungalsoththu/grievance-scout:latest
```

## Testing & Coverage

Grievance Scout includes a comprehensive test suite covering core functionality:

```bash
# Run all tests
bun test

# Run with coverage report
bun test --coverage

# Run specific test suites
bun test tests/simple.test.ts
```

### Test Coverage

| Component | Tests | Coverage |
|-----------|-------|----------|
| Database Core | 3 | Handle storage, complaint CRUD, aggregation queries |
| Passive Rotator | 2 | Query prioritization, jitter calculation |
| Categorization | 3 | Keyword-based classification logic |
| Escalation Detection | 2 | Frustration keyword detection |
| **Total** | **10** | **Core functionality verified** |

### Sample Test Output

```
✓ Database Core (3 tests)
  ✓ should store and retrieve handles
  ✓ should store complaints with categories
  ✓ should count complaints by category

✓ Passive Rotator (2 tests)
  ✓ should prioritize mention queries
  ✓ should calculate jitter correctly

✓ Categorization (3 tests)
  ✓ should categorize route issues
  ✓ should categorize delays
  ✓ should categorize staff issues

✓ Escalation Detection (2 tests)
  ✓ should detect escalation keywords
  ✓ should not flag normal complaints

10 pass, 0 fail
```

### Continuous Integration

Every push and PR runs:
- Type checking with `tsc --noEmit`
- Database initialization tests
- Full test suite with coverage
- JUnit reports for GitHub Actions

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

## Roadmap

### ✅ Phase 1: Core Platform (Complete)
- [x] SQLite database adapter with Bun native SQLite
- [x] Handle management and configuration
- [x] Complaint/response storage and linking
- [x] Passive query rotator with jitter
- [x] Basic categorization (keyword-based)
- [x] Escalation detection
- [x] Weekly report generation
- [x] Docker containerization
- [x] GitHub Actions CI/CD
- [x] Test suite (10 tests)

### 🚧 Phase 2: Intelligence (In Progress)
- [ ] LLM categorization via Zo API
- [ ] Sentiment analysis
- [ ] Response quality scoring
- [ ] Auto-categorization refinement
- [ ] Duplicate complaint detection

### 📋 Phase 3: Scale & Distribution
- [ ] Turso database adapter (distributed SQLite)
- [ ] Multi-region deployment
- [ ] Handle sharding across instances
- [ ] Redis-based queue for large deployments

### 📋 Phase 4: Analysis & Insights
- [ ] Trend analysis (week-over-week)
- [ ] Predictive escalation alerts
- [ ] Response time benchmarking
- [ ] Category heatmaps
- [ ] Top complaint topics (TF-IDF)

### 📋 Phase 5: Integrations
- [ ] Telegram notifications for escalations
- [ ] Slack webhook for team alerts
- [ ] Email digests (daily/weekly)
- [ ] Notion database sync
- [ ] Google Sheets export
- [ ] REST API for external dashboards

### 📋 Phase 6: Data Sources
- [ ] Facebook Pages support
- [ ] Reddit monitoring (r/chennai, etc.)
- [ ] YouTube comment tracking
- [ ] News article monitoring
- [ ] Complaint portal scraping

### 📋 Phase 7: Advanced Features
- [ ] Multi-language support (Tamil, Hindi)
- [ ] Image/media analysis
- [ ] Geolocation extraction
- [ ] Network graph of complainants
- [ ] Response template suggestions

## License

MIT - Created for Zo Computer by ungalsoththu.zo.computer
