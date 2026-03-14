/**
 * SQLite Database Adapter
 * Default local backend - portable, file-based
 */

import Database from 'better-sqlite3';
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
  walMode?: boolean;
  busyTimeoutMs?: number;
}

export class SQLiteAdapter implements DatabaseAdapter {
  private db: Database.Database | null = null;
  private config: SQLiteConfig;

  constructor(config: SQLiteConfig) {
    this.config = {
      walMode: true,
      busyTimeoutMs: 5000,
      ...config
    };
  }

  async connect(): Promise<void> {
    this.db = new Database(this.config.path);
    
    if (this.config.walMode) {
      this.db.pragma('journal_mode = WAL');
    }
    
    this.db.pragma(`busy_timeout = ${this.config.busyTimeoutMs}`);
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async runMigrations(): Promise<void> {
    if (!this.db) throw new Error('Database not connected');

    // Handles table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS handles (
        id TEXT PRIMARY KEY,
        handle TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        city TEXT,
        auth_profile TEXT DEFAULT 'default',
        is_active INTEGER DEFAULT 1,
        categories TEXT, -- JSON array
        search_config TEXT, -- JSON
        escalation_rules TEXT, -- JSON
        last_scan_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Complaints table
    this.db.exec(`
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
        last_checked_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (handle) REFERENCES handles(id)
      );

      CREATE INDEX IF NOT EXISTS idx_complaints_handle ON complaints(handle);
      CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
      CREATE INDEX IF NOT EXISTS idx_complaints_posted_at ON complaints(posted_at);
      CREATE INDEX IF NOT EXISTS idx_complaints_category ON complaints(category);
    `);

    // Responses table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS responses (
        id TEXT PRIMARY KEY,
        handle TEXT NOT NULL,
        in_reply_to_id TEXT,
        tweet_url TEXT NOT NULL,
        content TEXT NOT NULL,
        posted_at TEXT NOT NULL,
        response_time_minutes INTEGER,
        is_resolution_attempt INTEGER DEFAULT 0,
        first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (handle) REFERENCES handles(id),
        FOREIGN KEY (in_reply_to_id) REFERENCES complaints(id)
      );

      CREATE INDEX IF NOT EXISTS idx_responses_handle ON responses(handle);
      CREATE INDEX IF NOT EXISTS idx_responses_in_reply ON responses(in_reply_to_id);
    `);

    // Search terms table
    this.db.exec(`
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
        UNIQUE(handle, term, term_type),
        FOREIGN KEY (handle) REFERENCES handles(id)
      );

      CREATE INDEX IF NOT EXISTS idx_search_terms_handle ON search_terms(handle);
      CREATE INDEX IF NOT EXISTS idx_search_terms_type ON search_terms(term_type);
    `);

    // Reports table
    this.db.exec(`
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
        UNIQUE(handle, week_start),
        FOREIGN KEY (handle) REFERENCES handles(id)
      );
    `);
  }

  // Handle management
  async getActiveHandles(): Promise<HandleConfig[]> {
    if (!this.db) throw new Error('Database not connected');
    
    const rows = this.db.prepare(
      'SELECT * FROM handles WHERE is_active = 1'
    ).all() as any[];

    return rows.map(row => this.parseHandleRow(row));
  }

  async getHandleById(id: string): Promise<HandleConfig | null> {
    if (!this.db) throw new Error('Database not connected');
    
    const row = this.db.prepare('SELECT * FROM handles WHERE id = ?').get(id) as any;
    if (!row) return null;
    
    return this.parseHandleRow(row);
  }

  async updateHandleLastScan(handle: string, timestamp: Date): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    
    this.db.prepare(
      'UPDATE handles SET last_scan_at = ? WHERE id = ?'
    ).run(timestamp.toISOString(), handle);
  }

  // Complaints
  async upsertComplaint(complaint: Complaint): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    
    const stmt = this.db.prepare(`
      INSERT INTO complaints (
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
        last_checked_at = excluded.last_checked_at
    `);

    stmt.run(
      complaint.id,
      complaint.handle,
      complaint.authorHandle,
      complaint.authorName,
      complaint.tweetUrl,
      complaint.content,
      complaint.postedAt.toISOString(),
      complaint.category || null,
      complaint.sentiment || null,
      complaint.isEscalated ? 1 : 0,
      complaint.escalationReason || null,
      complaint.status,
      complaint.firstSeenAt.toISOString(),
      complaint.lastCheckedAt.toISOString()
    );
  }

  async getComplaintById(id: string): Promise<Complaint | null> {
    if (!this.db) throw new Error('Database not connected');
    
    const row = this.db.prepare('SELECT * FROM complaints WHERE id = ?').get(id) as any;
    if (!row) return null;
    
    return this.parseComplaintRow(row);
  }

  async getComplaints(filter: ComplaintFilter): Promise<Complaint[]> {
    if (!this.db) throw new Error('Database not connected');
    
    let sql = 'SELECT * FROM complaints WHERE 1=1';
    const params: any[] = [];

    if (filter.handle) {
      sql += ' AND handle = ?';
      params.push(filter.handle);
    }
    if (filter.status) {
      sql += ' AND status = ?';
      params.push(filter.status);
    }
    if (filter.category) {
      sql += ' AND category = ?';
      params.push(filter.category);
    }
    if (filter.since) {
      sql += ' AND posted_at >= ?';
      params.push(filter.since.toISOString());
    }
    if (filter.until) {
      sql += ' AND posted_at <= ?';
      params.push(filter.until.toISOString());
    }

    sql += ' ORDER BY posted_at DESC';

    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
      if (filter.offset) {
        sql += ' OFFSET ?';
        params.push(filter.offset);
      }
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => this.parseComplaintRow(row));
  }

  async getComplaintsWithoutResponse(handle: string, since: Date): Promise<Complaint[]> {
    if (!this.db) throw new Error('Database not connected');
    
    const rows = this.db.prepare(`
      SELECT * FROM complaints 
      WHERE handle = ? 
        AND status IN ('pending', 'no_response')
        AND posted_at >= ?
      ORDER BY posted_at ASC
    `).all(handle, since.toISOString()) as any[];

    return rows.map(row => this.parseComplaintRow(row));
  }

  async updateComplaintStatus(id: string, status: string, responseId?: string): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    
    if (responseId) {
      this.db.prepare(
        'UPDATE complaints SET status = ?, response_id = ? WHERE id = ?'
      ).run(status, responseId, id);
    } else {
      this.db.prepare(
        'UPDATE complaints SET status = ? WHERE id = ?'
      ).run(status, id);
    }
  }

  // Responses
  async upsertResponse(response: Response): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    
    const stmt = this.db.prepare(`
      INSERT INTO responses (
        id, handle, in_reply_to_id, tweet_url, content,
        posted_at, response_time_minutes, is_resolution_attempt, first_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        response_time_minutes = excluded.response_time_minutes,
        is_resolution_attempt = excluded.is_resolution_attempt
    `);

    stmt.run(
      response.id,
      response.handle,
      response.inReplyToId,
      response.tweetUrl,
      response.content,
      response.postedAt.toISOString(),
      response.responseTimeMinutes || null,
      response.isResolutionAttempt ? 1 : 0,
      response.firstSeenAt.toISOString()
    );
  }

  async getResponseById(id: string): Promise<Response | null> {
    if (!this.db) throw new Error('Database not connected');
    
    const row = this.db.prepare('SELECT * FROM responses WHERE id = ?').get(id) as any;
    if (!row) return null;
    
    return this.parseResponseRow(row);
  }

  async linkResponseToComplaint(responseId: string, complaintId: string): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    
    this.db.prepare(
      'UPDATE responses SET in_reply_to_id = ? WHERE id = ?'
    ).run(complaintId, responseId);
  }

  // Search terms
  async getSearchTerms(handle: string, type?: string): Promise<SearchTerm[]> {
    if (!this.db) throw new Error('Database not connected');
    
    let sql = 'SELECT * FROM search_terms WHERE handle = ?';
    const params: any[] = [handle];

    if (type) {
      sql += ' AND term_type = ?';
      params.push(type);
    }

    sql += ' ORDER BY hit_count DESC, confidence DESC';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => this.parseSearchTermRow(row));
  }

  async addSearchTerm(term: Omit<SearchTerm, 'id' | 'createdAt'>): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    
    const id = crypto.randomUUID();
    
    try {
      this.db.prepare(`
        INSERT INTO search_terms (id, handle, term, term_type, source, confidence, hit_count, last_used_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        term.handle,
        term.term,
        term.termType,
        term.source,
        term.confidence,
        term.hitCount,
        term.lastUsedAt?.toISOString() || null,
        new Date().toISOString()
      );
    } catch (err) {
      // Ignore duplicate key errors
      if (!(err as Error).message.includes('UNIQUE constraint failed')) {
        throw err;
      }
    }
  }

  async incrementTermHitCount(termId: string): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    
    this.db.prepare(
      'UPDATE search_terms SET hit_count = hit_count + 1 WHERE id = ?'
    ).run(termId);
  }

  async markTermUsed(termId: string): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    
    this.db.prepare(
      'UPDATE search_terms SET last_used_at = ? WHERE id = ?'
    ).run(new Date().toISOString(), termId);
  }

  // Enrichment
  async extractTopRoutes(handle: string, limit: number): Promise<string[]> {
    if (!this.db) throw new Error('Database not connected');
    
    // Route pattern: numbers followed by optional letter
    const pattern = /\b(\d{1,3}[A-Z]?)\b/g;
    const rows = this.db.prepare(
      'SELECT content FROM complaints WHERE handle = ?'
    ).all(handle) as { content: string }[];

    const routeCounts = new Map<string, number>();
    
    for (const row of rows) {
      const matches = row.content.match(pattern) || [];
      for (const match of matches) {
        // Filter: must be likely a bus route (1-3 digits, maybe letter)
        if (/^\d{1,3}[A-Z]?$/.test(match) && !['AM', 'PM'].includes(match)) {
          routeCounts.set(match, (routeCounts.get(match) || 0) + 1);
        }
      }
    }

    return Array.from(routeCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([route]) => route);
  }

  async extractTopStops(handle: string, limit: number): Promise<string[]> {
    if (!this.db) throw new Error('Database not connected');
    
    // Extract capitalized phrases that appear frequently
    // Simple heuristic: words starting with capital in the middle of sentences
    const rows = this.db.prepare(
      'SELECT content FROM complaints WHERE handle = ?'
    ).all(handle) as { content: string }[];

    const stopCounts = new Map<string, number>();
    const stopPattern = /\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\b/g;

    for (const row of rows) {
      const matches = row.content.match(stopPattern) || [];
      for (const match of matches) {
        // Filter out common words, must be 2+ words or very frequent
        const lower = match.toLowerCase();
        if (!this.isCommonWord(lower) && match.length > 4) {
          stopCounts.set(match, (stopCounts.get(match) || 0) + 1);
        }
      }
    }

    return Array.from(stopCounts.entries())
      .filter(([_, count]) => count >= 2) // Must appear at least twice
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([stop]) => stop);
  }

  async extractFrequentKeywords(handle: string, limit: number): Promise<string[]> {
    if (!this.db) throw new Error('Database not connected');
    
    const rows = this.db.prepare(
      'SELECT content FROM complaints WHERE handle = ?'
    ).all(handle) as { content: string }[];

    const wordCounts = new Map<string, number>();
    
    for (const row of rows) {
      const words = row.content.toLowerCase()
        .replace(/[^a-z\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3 && !this.isCommonWord(w));
      
      for (const word of words) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    }

    return Array.from(wordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([word]) => word);
  }

  async extractPatternMatches(handle: string, pattern: RegExp, limit: number): Promise<string[]> {
    if (!this.db) throw new Error('Database not connected');
    
    const rows = this.db.prepare(
      'SELECT content FROM complaints WHERE handle = ?'
    ).all(handle) as { content: string }[];

    const matches = new Set<string>();
    
    for (const row of rows) {
      const rowMatches = row.content.match(pattern) || [];
      for (const match of rowMatches) {
        matches.add(match);
        if (matches.size >= limit) break;
      }
      if (matches.size >= limit) break;
    }

    return Array.from(matches);
  }

  // Reports
  async saveReport(report: Report): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    
    this.db.prepare(`
      INSERT INTO reports (
        id, handle, week_start, week_end, total_complaints,
        responded_count, avg_response_time_minutes, resolution_rate,
        escalation_count, report_path, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(handle, week_start) DO UPDATE SET
        total_complaints = excluded.total_complaints,
        responded_count = excluded.responded_count,
        avg_response_time_minutes = excluded.avg_response_time_minutes,
        resolution_rate = excluded.resolution_rate,
        escalation_count = excluded.escalation_count,
        report_path = excluded.report_path,
        generated_at = excluded.generated_at
    `).run(
      report.id,
      report.handle,
      report.weekStart.toISOString(),
      report.weekEnd.toISOString(),
      report.totalComplaints,
      report.respondedCount,
      report.avgResponseTimeMinutes,
      report.resolutionRate,
      report.escalationCount,
      report.reportPath,
      report.generatedAt.toISOString()
    );
  }

  async getReport(handle: string, weekStart: Date): Promise<Report | null> {
    if (!this.db) throw new Error('Database not connected');
    
    const row = this.db.prepare(
      'SELECT * FROM reports WHERE handle = ? AND week_start = ?'
    ).get(handle, weekStart.toISOString()) as any;
    
    if (!row) return null;
    return this.parseReportRow(row);
  }

  async getReports(handle?: string, limit: number = 10): Promise<Report[]> {
    if (!this.db) throw new Error('Database not connected');
    
    let sql = 'SELECT * FROM reports';
    const params: any[] = [];

    if (handle) {
      sql += ' WHERE handle = ?';
      params.push(handle);
    }

    sql += ' ORDER BY week_start DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => this.parseReportRow(row));
  }

  // Stats
  async getStats(handle?: string, since?: Date): Promise<AuditStats> {
    if (!this.db) throw new Error('Database not connected');
    
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (handle) {
      whereClause += ' AND handle = ?';
      params.push(handle);
    }

    if (since) {
      whereClause += ' AND posted_at >= ?';
      params.push(since.toISOString());
    }

    const totalResult = this.db.prepare(
      `SELECT COUNT(*) as count FROM complaints ${whereClause}`
    ).get(...params) as { count: number };

    const respondedResult = this.db.prepare(
      `SELECT COUNT(*) as count FROM complaints ${whereClause} AND status IN ('responded', 'resolved')`
    ).get(...params) as { count: number };

    const avgTimeResult = this.db.prepare(`
      SELECT AVG(response_time_minutes) as avg_time
      FROM responses r
      JOIN complaints c ON r.in_reply_to_id = c.id
      ${whereClause.replace('handle', 'c.handle').replace('posted_at', 'c.posted_at')}
    `).get(...params) as { avg_time: number | null };

    const escalatedResult = this.db.prepare(
      `SELECT COUNT(*) as count FROM complaints ${whereClause} AND is_escalated = 1`
    ).get(...params) as { count: number };

    const categoryResult = this.db.prepare(`
      SELECT category, COUNT(*) as count
      FROM complaints
      ${whereClause}
      AND category IS NOT NULL
      GROUP BY category
      ORDER BY count DESC
      LIMIT 5
    `).all(...params) as { category: string; count: number }[];

    const total = totalResult.count;
    const responded = respondedResult.count;

    return {
      totalComplaints: total,
      totalResponses: responded,
      avgResponseTimeMinutes: avgTimeResult.avg_time || 0,
      responseRate: total > 0 ? responded / total : 0,
      escalationRate: total > 0 ? escalatedResult.count / total : 0,
      topCategories: categoryResult.map(r => ({ category: r.category, count: r.count }))
    };
  }

  async getWeeklyStats(handle: string, weekStart: Date): Promise<AuditStats> {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    return this.getStats(handle, weekStart);
  }

  // Private helpers
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

  private parseReportRow(row: any): Report {
    return {
      id: row.id,
      handle: row.handle,
      weekStart: new Date(row.week_start),
      weekEnd: new Date(row.week_end),
      totalComplaints: row.total_complaints,
      respondedCount: row.responded_count,
      avgResponseTimeMinutes: row.avg_response_time_minutes,
      resolutionRate: row.resolution_rate,
      escalationCount: row.escalation_count,
      reportPath: row.report_path,
      generatedAt: new Date(row.generated_at)
    };
  }

  private isCommonWord(word: string): boolean {
    const common = new Set([
      'this', 'that', 'with', 'have', 'from', 'they', 'will', 'been',
      'their', 'said', 'each', 'which', 'what', 'your', 'when',
      'about', 'could', 'would', 'should', 'there', 'where',
      'thank', 'please', 'sorry', 'hello', 'today', 'tomorrow',
      'morning', 'evening', 'night', 'chennai', 'bus', 'buses',
      'route', 'stop', 'station', 'driver', 'conductor', 'passenger'
    ]);
    return common.has(word.toLowerCase());
  }
}
