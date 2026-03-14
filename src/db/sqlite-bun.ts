/**
 * SQLite Database Adapter using Bun's built-in SQLite
 * More compatible than better-sqlite3 native bindings
 */

import { Database } from 'bun:sqlite';
import type {
  DatabaseAdapter,
  HandleConfig,
  Complaint,
  Response,
  SearchTerm,
  Report,
  ComplaintFilter,
  AuditStats
} from './interface';

export interface SQLiteConfig {
  path: string;
  create?: boolean;
}

export class BunSQLiteAdapter implements DatabaseAdapter {
  private db: Database | null = null;
  private config: SQLiteConfig;

  constructor(config: SQLiteConfig) {
    this.config = {
      create: true,
      ...config
    };
  }

  async connect(): Promise<void> {
    this.db = new Database(this.config.path, { create: this.config.create });
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async runMigrations(): Promise<void> {
    if (!this.db) throw new Error('Database not connected');

    this.db.run(`
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
    `);

    this.db.run(`
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
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_complaints_handle ON complaints(handle);
      CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
      CREATE INDEX IF NOT EXISTS idx_complaints_posted_at ON complaints(posted_at);
    `);

    this.db.run(`
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
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_responses_handle ON responses(handle);
      CREATE INDEX IF NOT EXISTS idx_responses_in_reply ON responses(in_reply_to_id);
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS search_terms (
        id TEXT PRIMARY KEY,
        handle TEXT NOT NULL,
        term TEXT NOT NULL,
        term_type TEXT CHECK(term_type IN ('mention', 'route', 'stop', 'keyword', 'timeslice')),
        source TEXT CHECK(source IN ('manual', 'extracted', 'generated')),
        confidence REAL DEFAULT 1.0,
        hit_count INTEGER DEFAULT 0,
        last_used_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(handle, term, term_type)
      );
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_search_terms_handle ON search_terms(handle);
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        handle TEXT NOT NULL,
        week_start TEXT NOT NULL,
        week_end TEXT NOT NULL,
        total_complaints INTEGER DEFAULT 0,
        responded_count INTEGER DEFAULT 0,
        avg_response_time_minutes REAL,
        resolution_rate REAL,
        escalation_count INTEGER DEFAULT 0,
        report_path TEXT,
        generated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(handle, week_start)
      );
    `);
  }

  async getActiveHandles(): Promise<HandleConfig[]> {
    if (!this.db) throw new Error('Database not connected');
    const query = this.db.query('SELECT * FROM handles WHERE is_active = 1');
    const rows = query.all() as any[];
    query.finalize();
    return rows.map(row => this.parseHandleRow(row));
  }

  async getHandleById(id: string): Promise<HandleConfig | null> {
    if (!this.db) throw new Error('Database not connected');
    const query = this.db.query('SELECT * FROM handles WHERE id = ?');
    const row = query.get(id) as any;
    query.finalize();
    if (!row) return null;
    return this.parseHandleRow(row);
  }

  async updateHandleLastScan(handle: string, timestamp: Date): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    this.db.run('UPDATE handles SET last_scan_at = ? WHERE id = ?',
      [timestamp.toISOString(), handle]);
  }

  async upsertComplaint(complaint: Complaint): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    this.db.run(`INSERT INTO complaints (
        id, handle, author_handle, author_name, tweet_url, content,
        posted_at, category, sentiment, is_escalated, escalation_reason,
        status, first_seen_at, last_checked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        category = excluded.category,
        sentiment = excluded.sentiment,
        is_escalated = excluded.is_escalated,
        escalation_reason = excluded.escalation_reason,
        status = excluded.status,
        last_checked_at = excluded.last_checked_at`,
      [
        complaint.id, complaint.handle, complaint.authorHandle, complaint.authorName,
        complaint.tweetUrl, complaint.content, complaint.postedAt.toISOString(),
        complaint.category || null, complaint.sentiment || null,
        complaint.isEscalated ? 1 : 0, complaint.escalationReason || null,
        complaint.status, complaint.firstSeenAt.toISOString(),
        complaint.lastCheckedAt.toISOString()
      ]
    );
  }

  async getComplaintById(id: string): Promise<Complaint | null> {
    if (!this.db) throw new Error('Database not connected');
    const query = this.db.query('SELECT * FROM complaints WHERE id = ?');
    const row = query.get(id) as any;
    query.finalize();
    if (!row) return null;
    return this.parseComplaintRow(row);
  }

  async getComplaints(filter: ComplaintFilter): Promise<Complaint[]> {
    if (!this.db) throw new Error('Database not connected');
    let sql = 'SELECT * FROM complaints WHERE 1=1';
    const params: any[] = [];

    if (filter.handle) { sql += ' AND handle = ?'; params.push(filter.handle); }
    if (filter.status) { sql += ' AND status = ?'; params.push(filter.status); }
    if (filter.since) { sql += ' AND posted_at >= ?'; params.push(filter.since.toISOString()); }
    if (filter.until) { sql += ' AND posted_at <= ?'; params.push(filter.until.toISOString()); }
    sql += ' ORDER BY posted_at DESC';
    if (filter.limit) { sql += ' LIMIT ?'; params.push(filter.limit); }

    const query = this.db.query(sql);
    const rows = query.all(...params) as any[];
    query.finalize();
    return rows.map(row => this.parseComplaintRow(row));
  }

  async getComplaintsWithoutResponse(handle: string, since: Date): Promise<Complaint[]> {
    if (!this.db) throw new Error('Database not connected');
    const query = this.db.query(`SELECT * FROM complaints 
      WHERE handle = ? AND status IN ('pending', 'no_response') AND posted_at >= ?
      ORDER BY posted_at ASC`);
    const rows = query.all(handle, since.toISOString()) as any[];
    query.finalize();
    return rows.map(row => this.parseComplaintRow(row));
  }

  async updateComplaintStatus(id: string, status: string, responseId?: string): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    if (responseId) {
      this.db.run('UPDATE complaints SET status = ?, response_id = ? WHERE id = ?',
        [status, responseId, id]);
    } else {
      this.db.run('UPDATE complaints SET status = ? WHERE id = ?', [status, id]);
    }
  }

  async upsertResponse(response: Response): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    this.db.run(`INSERT INTO responses (
        id, handle, in_reply_to_id, tweet_url, content,
        posted_at, response_time_minutes, is_resolution_attempt, first_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        response_time_minutes = excluded.response_time_minutes,
        is_resolution_attempt = excluded.is_resolution_attempt`,
      [
        response.id, response.handle, response.inReplyToId, response.tweetUrl,
        response.content, response.postedAt.toISOString(),
        response.responseTimeMinutes || null,
        response.isResolutionAttempt ? 1 : 0,
        response.firstSeenAt.toISOString()
      ]
    );
  }

  async getResponseById(id: string): Promise<Response | null> {
    if (!this.db) throw new Error('Database not connected');
    const query = this.db.query('SELECT * FROM responses WHERE id = ?');
    const row = query.get(id) as any;
    query.finalize();
    if (!row) return null;
    return this.parseResponseRow(row);
  }

  async linkResponseToComplaint(responseId: string, complaintId: string): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    this.db.run('UPDATE responses SET in_reply_to_id = ? WHERE id = ?',
      [complaintId, responseId]);
  }

  async getSearchTerms(handle: string, type?: string): Promise<SearchTerm[]> {
    if (!this.db) throw new Error('Database not connected');
    let sql = 'SELECT * FROM search_terms WHERE handle = ?';
    const params: any[] = [handle];
    if (type) { sql += ' AND term_type = ?'; params.push(type); }
    sql += ' ORDER BY hit_count DESC, confidence DESC';
    const query = this.db.query(sql);
    const rows = query.all(...params) as any[];
    query.finalize();
    return rows.map(row => this.parseSearchTermRow(row));
  }

  async addSearchTerm(term: Omit<SearchTerm, 'id' | 'createdAt'>): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    const id = crypto.randomUUID();
    try {
      this.db.run(`INSERT INTO search_terms (id, handle, term, term_type, source, confidence, hit_count, last_used_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, term.handle, term.term, term.termType, term.source, term.confidence, term.hitCount,
         term.lastUsedAt?.toISOString() || null, new Date().toISOString()]);
    } catch (err) {
      if (!(err as Error).message.includes('UNIQUE constraint failed')) throw err;
    }
  }

  async incrementTermHitCount(termId: string): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    this.db.run('UPDATE search_terms SET hit_count = hit_count + 1 WHERE id = ?', [termId]);
  }

  async markTermUsed(termId: string): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    this.db.run('UPDATE search_terms SET last_used_at = ? WHERE id = ?',
      [new Date().toISOString(), termId]);
  }

  async extractTopRoutes(handle: string, limit: number): Promise<string[]> {
    if (!this.db) throw new Error('Database not connected');
    const query = this.db.query('SELECT content FROM complaints WHERE handle = ?');
    const rows = query.all(handle) as { content: string }[];
    query.finalize();
    const routeCounts = new Map<string, number>();
    for (const row of rows) {
      const matches = row.content.match(/\b(\d{1,3}[A-Z]?)\b/g) || [];
      for (const match of matches) {
        if (/^\d{1,3}[A-Z]?$/.test(match) && !['AM', 'PM'].includes(match)) {
          routeCounts.set(match, (routeCounts.get(match) || 0) + 1);
        }
      }
    }
    return Array.from(routeCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([r]) => r);
  }

  async extractTopStops(handle: string, limit: number): Promise<string[]> {
    if (!this.db) throw new Error('Database not connected');
    const query = this.db.query('SELECT content FROM complaints WHERE handle = ?');
    const rows = query.all(handle) as { content: string }[];
    query.finalize();
    return [];
  }

  async extractFrequentKeywords(handle: string, limit: number): Promise<string[]> {
    if (!this.db) throw new Error('Database not connected');
    return [];
  }

  async extractPatternMatches(handle: string, pattern: RegExp, limit: number): Promise<string[]> {
    return [];
  }

  async saveReport(report: Report): Promise<void> {}
  async getReport(handle: string, weekStart: Date): Promise<Report | null> { return null; }
  async getReports(handle?: string, limit?: number): Promise<Report[]> { return []; }

  async getStats(handle?: string, since?: Date): Promise<AuditStats> {
    return {
      totalComplaints: 0,
      totalResponses: 0,
      avgResponseTimeMinutes: 0,
      responseRate: 0,
      escalationRate: 0,
      topCategories: []
    };
  }

  async getWeeklyStats(handle: string, weekStart: Date): Promise<AuditStats> {
    return this.getStats(handle, weekStart);
  }

  private parseHandleRow(row: any): HandleConfig {
    return {
      id: row.id,
      handle: row.handle,
      name: row.name,
      city: row.city,
      authProfile: row.auth_profile || 'default',
      isActive: row.is_active === 1,
      categories: JSON.parse(row.categories || '[]'),
      searchConfig: JSON.parse(row.search_config || '{}'),
      escalationRules: JSON.parse(row.escalation_rules || '{}')
    };
  }

  private parseComplaintRow(row: any): Complaint {
    return {
      id: row.id,
      handle: row.handle,
      authorHandle: row.author_handle,
      authorName: row.author_name,
      tweetUrl: row.tweet_url,
      content: row.content,
      postedAt: new Date(row.posted_at),
      category: row.category,
      sentiment: row.sentiment,
      isEscalated: row.is_escalated === 1,
      escalationReason: row.escalation_reason,
      status: row.status,
      firstSeenAt: new Date(row.first_seen_at),
      lastCheckedAt: new Date(row.last_checked_at)
    };
  }

  private parseResponseRow(row: any): Response {
    return {
      id: row.id,
      handle: row.handle,
      inReplyToId: row.in_reply_to_id,
      tweetUrl: row.tweet_url,
      content: row.content,
      postedAt: new Date(row.posted_at),
      responseTimeMinutes: row.response_time_minutes,
      isResolutionAttempt: row.is_resolution_attempt === 1,
      firstSeenAt: new Date(row.first_seen_at)
    };
  }

  private parseSearchTermRow(row: any): SearchTerm {
    return {
      id: row.id,
      handle: row.handle,
      term: row.term,
      termType: row.term_type,
      source: row.source,
      confidence: row.confidence,
      hitCount: row.hit_count,
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : undefined,
      createdAt: new Date(row.created_at)
    };
  }
}
