-- Name: Initial schema
-- Version: 1.0.0

-- Handles configuration
CREATE TABLE IF NOT EXISTS handles (
  id TEXT PRIMARY KEY,
  handle TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  city TEXT,
  auth_profile TEXT DEFAULT 'default',
  is_active INTEGER DEFAULT 1,
  categories TEXT,
  search_config TEXT,
  escalation_rules TEXT,
  last_scan_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Complaints from citizens
CREATE TABLE IF NOT EXISTS complaints (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  author_handle TEXT NOT NULL,
  author_name TEXT,
  tweet_url TEXT NOT NULL,
  content TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  category TEXT,
  sentiment TEXT CHECK(sentiment IN ('negative', 'neutral', 'positive')),
  is_escalated INTEGER DEFAULT 0,
  escalation_reason TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'responded', 'resolved', 'no_response', 'escalated')),
  response_id TEXT,
  first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_complaints_handle ON complaints(handle);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_posted_at ON complaints(posted_at);

-- Responses from monitored handles
CREATE TABLE IF NOT EXISTS responses (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  in_reply_to_id TEXT,
  tweet_url TEXT NOT NULL,
  content TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  response_time_minutes INTEGER,
  is_resolution_attempt INTEGER DEFAULT 0,
  first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_responses_handle ON responses(handle);
CREATE INDEX IF NOT EXISTS idx_responses_in_reply ON responses(in_reply_to_id);

-- Search terms for passive discovery
CREATE TABLE IF NOT EXISTS search_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handle_id TEXT NOT NULL,
  term TEXT NOT NULL,
  term_type TEXT NOT NULL,
  priority INTEGER DEFAULT 2,
  confidence REAL DEFAULT 1.0,
  hit_count INTEGER DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(handle_id, term)
);

CREATE INDEX IF NOT EXISTS idx_terms_handle ON search_terms(handle_id);
CREATE INDEX IF NOT EXISTS idx_terms_type ON search_terms(term_type);

-- Weekly audit reports
CREATE TABLE IF NOT EXISTS audit_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handle TEXT NOT NULL,
  week_start TEXT NOT NULL,
  week_end TEXT NOT NULL,
  total_complaints INTEGER DEFAULT 0,
  total_responses INTEGER DEFAULT 0,
  response_rate REAL DEFAULT 0,
  avg_response_time_minutes INTEGER,
  escalated_count INTEGER DEFAULT 0,
  report_path TEXT,
  generated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reports_handle_week ON audit_reports(handle, week_start);

-- DOWN
DROP TABLE IF EXISTS audit_reports;
DROP TABLE IF EXISTS search_terms;
DROP TABLE IF EXISTS responses;
DROP TABLE IF EXISTS complaints;
DROP TABLE IF EXISTS handles;
