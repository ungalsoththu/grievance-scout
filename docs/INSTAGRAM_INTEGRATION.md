# Instagram Integration Plan

## Overview

Adding Instagram as a grievance source for monitoring public service complaints via:
- Comments on official account posts
- @mentions in posts/stories
- Tagged location posts

## API Options

### 1. Instagram Graph API (Recommended)
**Requirements:**
- Facebook Business account
- Instagram Business/Creator account
- Meta app with `instagram_basic`, `instagram_manage_insights` permissions
- OAuth token with these scopes

**Access Pattern:**
```
GET /{ig-user-id}/media
GET /{media-id}/comments
GET /{ig-user-id}/mentions
```

**Rate Limits:**
- 200 calls/hour per user (media)
- 100 calls/hour per user (comments)

### 2. Basic Display API (Limited)
- Only for getting own content
- Cannot access @mentions or comments on other accounts
- **Not suitable for grievance monitoring**

## Implementation Design

### New Files

```
src/search/instagram-client.ts     # Instagram Graph API client
src/search/instagram-rotator.ts      # Instagram-specific rotator
config/instagram-handles.json        # Instagram-specific config
```

### Data Model Additions

```sql
-- Instagram-specific tables
instagram_handles (
  id TEXT PRIMARY KEY,
  ig_user_id TEXT UNIQUE,          -- Instagram's internal ID
  username TEXT UNIQUE NOT NULL,
  business_account_id TEXT,         -- For Graph API
  access_token TEXT,                -- OAuth token
  token_expires_at TEXT,
  is_active INTEGER DEFAULT 1,
  last_comment_scan TEXT,
  last_mention_scan TEXT
);

instagram_comments (
  id TEXT PRIMARY KEY,
  ig_handle_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  comment_id TEXT UNIQUE NOT NULL,
  author_username TEXT,
  content TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  is_reply INTEGER DEFAULT 0,
  parent_comment_id TEXT,
  is_mention INTEGER DEFAULT 0
);

instagram_mentions (
  id TEXT PRIMARY KEY,
  ig_handle_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  mentioner_username TEXT,
  caption TEXT,
  media_type TEXT,                  -- IMAGE, VIDEO, CAROUSEL_ALBUM, REEL, STORY
  posted_at TEXT NOT NULL,
  permalink TEXT,
  thumbnail_url TEXT
);
```

### Instagram Client Interface

```typescript
export interface InstagramClient {
  // Fetch recent posts from account
  getRecentMedia(limit?: number): Promise<InstagramMedia[]>;
  
  // Fetch comments on specific media
  getComments(mediaId: string, limit?: number): Promise<InstagramComment[]>;
  
  // Fetch @mentions of the account
  getMentions(limit?: number): Promise<InstagramMention[]>;
  
  // Reply to a comment (for escalation response tracking)
  replyToComment(commentId: string, message: string): Promise<void>;
}
```

## Passive Querying Strategy (Instagram)

Instagram's rate limits require different pacing:

| Query Type | Interval | Priority | Notes |
|------------|----------|----------|-------|
| Recent posts | 15 min | P1 | Get new posts to scan comments |
| Comments on posts | 30 min | P2 | Check for new comments |
| @mentions | 1 hour | P2 | Instagram's mention API is slower |
| Historical backfill | 4 hours | P4 | Very limited, 30-day window |

## Setup Requirements

### For Users (MTC Chennai Example)

1. **Convert to Business Account**
   - Instagram Settings → Account → Switch to Professional Account
   - Select "Business" (not Creator for grievance handling)

2. **Connect to Facebook**
   - Link to Facebook Page (MTC Chennai would need a FB page)

3. **Create Meta App**
   - developers.facebook.com
   - Add Instagram Graph API product
   - Get App ID and Secret

4. **OAuth Flow**
   - User authorizes app: `scope=instagram_basic,instagram_manage_insights`
   - Store `access_token` with `expires_in` (typically 60 days)
   - Implement token refresh

### Environment Variables

```bash
INSTAGRAM_APP_ID=your_app_id
INSTAGRAM_APP_SECRET=your_app_secret
INSTAGRAM_ACCESS_TOKEN=long_lived_token
INSTAGRAM_REDIRECT_URI=https://your-callback.com
```

## Skill Implementation

Create `Skills/zo-instagram/` similar to `zo-twitter`:

```typescript
// Skills/zo-instagram/SKILL.md
// Skills/zo-instagram/scripts/instagram.ts
```

### CLI Usage

```bash
# After setting up auth
cd /home/workspace/Skills/zo-instagram
bun run scripts/instagram.ts search @mtc.chennai --type comments

# Get mentions
bun run scripts/instagram.ts mentions @mtc.chennai

# Scan for complaints
bun run scripts/instagram.ts audit @mtc.chennai --output json
```

## Integration with grievance-scout

### 1. Add to audit.ts

```typescript
// In audit.ts
import { InstagramClient } from './src/search/instagram-client';

// In handle loop
if (handleConfig.instagramUsername) {
  await processInstagramHandle(handleConfig, db, rotator);
}
```

### 2. Unified Complaint Model

Instagram comments map to the existing complaint model:

```typescript
{
  id: 'ig-comment-xyz',
  handle: 'mtc-chennai',
  tweetUrl: 'https://instagram.com/p/ABC123/c/xyz',  // Permalink
  complainantHandle: 'angry_passenger',
  postedAt: new Date('2026-03-14'),
  content: 'Bus 23B never came! Worst service',
  category: 'delay',
  source: 'instagram',  // NEW FIELD
  isEscalated: false,
  status: 'pending'
}
```

### 3. Add `source` field to schema

```sql
ALTER TABLE complaints ADD COLUMN source TEXT DEFAULT 'twitter' 
  CHECK(source IN ('twitter', 'instagram', 'facebook', 'reddit', 'manual'));
```

## Challenges & Mitigations

| Challenge | Mitigation |
|-----------|------------|
| No public search | Must have Business account that grants access |
| 60-day token expiry | Automatic refresh via cron/scheduled agent |
| Story mentions expire | Check every 4 hours, stories last 24h |
| Limited comment history | Only ~30 days available via API |
| Rate limits stricter | Lower priority tier, longer cooldowns |
| Requires user action | Business conversion, FB page setup |

## Implementation Priority

1. **Create zo-instagram skill** - Standalone tool first
2. **Test with @mtc.chennai** - Get them to convert to Business
3. **Add to grievance-scout** - Integrate into audit pipeline
4. **Update schema** - Add source field, Instagram tables
5. **Update reports** - Show source breakdown (Twitter vs Instagram complaints)

## Estimated Effort

| Task | Time |
|------|------|
| Create zo-instagram skill | 2-3 hours |
| Instagram client + rotator | 3-4 hours |
| Schema updates | 1 hour |
| Integration into audit.ts | 2 hours |
| Testing & documentation | 2 hours |
| **Total** | **10-12 hours** |

## Next Steps

1. **Confirm Instagram access** - Does @mtc.chennai have a Business account?
2. **Create zo-instagram skill** - Start with standalone tool
3. **Parallel development** - Can work on schema while getting API access

---

**Decision needed**: Should we prioritize Instagram (requires MTC to convert to Business) or other sources like Reddit/Facebook (easier access)?
