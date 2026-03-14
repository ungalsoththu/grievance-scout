/**
 * Database Adapter Interface
 * Pluggable backend: SQLite, Turso, or any SQL-compatible store
 */

export interface HandleConfig {
  id: string;
  handle: string;
  name: string;
  city?: string;
  authProfile: string;
  isActive: boolean;
  categories: string[];
  searchConfig: SearchConfig;
  escalationRules: EscalationRules;
}

export interface SearchConfig {
  discoveryEnabled: boolean;
  backfillEnabled: boolean;
  maxBackfillDepthDays: number;
  discoveryBatchSize: number;
}

export interface EscalationRules {
  noResponseHours: number;
  repeatComplaintThreshold: number;
  escalationKeywords: string[];
}

export interface Complaint {
  id: string;
  handle: string;
  authorHandle: string;
  authorName: string;
  tweetUrl: string;
  content: string;
  postedAt: Date;
  category?: string;
  sentiment?: 'negative' | 'neutral' | 'positive';
  isEscalated: boolean;
  escalationReason?: string;
  status: 'pending' | 'responded' | 'resolved' | 'no_response' | 'escalated';
  firstSeenAt: Date;
  lastCheckedAt: Date;
}

export interface Response {
  id: string;
  handle: string;
  inReplyToId: string | null;
  tweetUrl: string;
  content: string;
  postedAt: Date;
  responseTimeMinutes?: number;
  isResolutionAttempt: boolean;
  firstSeenAt: Date;
}

export interface SearchTerm {
  id: string;
  handle: string;
  term: string;
  termType: 'mention' | 'route' | 'stop' | 'keyword' | 'timeslice';
  source: 'manual' | 'extracted' | 'generated';
  confidence: number;
  hitCount: number;
  lastUsedAt?: Date;
  createdAt: Date;
}

export interface Report {
  id: string;
  handle: string;
  weekStart: Date;
  weekEnd: Date;
  totalComplaints: number;
  respondedCount: number;
  avgResponseTimeMinutes: number;
  resolutionRate: number;
  escalationCount: number;
  reportPath: string;
  generatedAt: Date;
}

export interface ComplaintFilter {
  handle?: string;
  status?: string;
  since?: Date;
  until?: Date;
  category?: string;
  limit?: number;
  offset?: number;
}

export interface AuditStats {
  totalComplaints: number;
  totalResponses: number;
  avgResponseTimeMinutes: number;
  responseRate: number;
  escalationRate: number;
  topCategories: { category: string; count: number }[];
}

export interface DatabaseAdapter {
  // Connection lifecycle
  connect(): Promise<void>;
  close(): Promise<void>;
  runMigrations(): Promise<void>;

  // Handle management
  getActiveHandles(): Promise<HandleConfig[]>;
  getHandleById(id: string): Promise<HandleConfig | null>;
  updateHandleLastScan(handle: string, timestamp: Date): Promise<void>;

  // Complaints
  upsertComplaint(complaint: Complaint): Promise<void>;
  getComplaintById(id: string): Promise<Complaint | null>;
  getComplaints(filter: ComplaintFilter): Promise<Complaint[]>;
  getComplaintsWithoutResponse(handle: string, since: Date): Promise<Complaint[]>;
  updateComplaintStatus(id: string, status: string, responseId?: string): Promise<void>;

  // Responses
  upsertResponse(response: Response): Promise<void>;
  getResponseById(id: string): Promise<Response | null>;
  linkResponseToComplaint(responseId: string, complaintId: string): Promise<void>;

  // Search terms (discovery)
  getSearchTerms(handle: string, type?: string): Promise<SearchTerm[]>;
  addSearchTerm(term: Omit<SearchTerm, 'id' | 'createdAt'>): Promise<void>;
  incrementTermHitCount(termId: string): Promise<void>;
  markTermUsed(termId: string): Promise<void>;

  // Enrichment - extract patterns from existing data
  extractTopRoutes(handle: string, limit: number): Promise<string[]>;
  extractTopStops(handle: string, limit: number): Promise<string[]>;
  extractFrequentKeywords(handle: string, limit: number): Promise<string[]>;
  extractPatternMatches(handle: string, pattern: RegExp, limit: number): Promise<string[]>;

  // Reports
  saveReport(report: Report): Promise<void>;
  getReport(handle: string, weekStart: Date): Promise<Report | null>;
  getReports(handle?: string, limit?: number): Promise<Report[]>;

  // Stats
  getStats(handle?: string, since?: Date): Promise<AuditStats>;
  getWeeklyStats(handle: string, weekStart: Date): Promise<AuditStats>;
}
