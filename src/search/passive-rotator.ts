/**
 * Passive Query Rotator
 * Prevents detection by rotating queries, adding jitter, and staying under rate limits
 */

export interface Query {
  id: string;
  query: string;
  termType: 'mention' | 'route' | 'stop' | 'keyword' | 'timeslice';
  handle: string;
  priority: 1 | 2 | 3 | 4;
}

export interface Tweet {
  id: string;
  url: string;
  content: string;
  authorHandle: string;
  authorName: string;
  postedAt: Date;
  inReplyToId?: string;
}

interface QueryState {
  query: Query;
  lastRunAt: Date | null;
  cooldownUntil: Date;
  consecutiveFailures: number;
  totalRuns: number;
}

export class PassiveRotator {
  private baseIntervals: Record<number, number> = {
    1: 5 * 60 * 1000,
    2: 15 * 60 * 1000,
    3: 30 * 60 * 1000,
    4: 2 * 60 * 60 * 1000
  };

  private queryStates: Map<string, QueryState> = new Map();
  private requestHistory: { timestamp: number }[] = [];
  private readonly maxRequestsPerWindow = 15;
  private readonly windowMs = 15 * 60 * 1000;

  constructor(
    private requestFn: (query: Query) => Promise<Tweet[]>,
    private options: {
      maxBackoffMs?: number;
      jitterPercent?: number;
    } = {}
  ) {
    this.options = {
      maxBackoffMs: 24 * 60 * 60 * 1000,
      jitterPercent: 0.30,
      ...options
    };
  }

  addQueries(queries: Query[]): void {
    for (const query of queries) {
      if (!this.queryStates.has(query.id)) {
        this.queryStates.set(query.id, {
          query,
          lastRunAt: null,
          cooldownUntil: new Date(0),
          consecutiveFailures: 0,
          totalRuns: 0
        });
      }
    }
  }

  async nextQuery(): Promise<Query | null> {
    await this.waitForRateLimitHeadroom();
    const now = Date.now();
    const candidates: { state: QueryState; score: number }[] = [];

    for (const state of this.queryStates.values()) {
      if (state.cooldownUntil.getTime() > now) {
        continue;
      }

      const priorityScore = 5 - state.query.priority;
      const ageScore = state.lastRunAt
        ? (now - state.lastRunAt.getTime()) / (1000 * 60 * 60)
        : 1000;
      const failurePenalty = state.consecutiveFailures * 10;
      const score = priorityScore * 1000 + ageScore - failurePenalty;
      candidates.push({ state, score });
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => b.score - a.score);
    const bestCandidate = candidates[Math.floor(Math.random() * Math.min(3, candidates.length))];
    const query = bestCandidate.state.query;
    const jitter = this.calculateJitter(query.priority);
    await this.sleep(jitter);
    return query;
  }

  async execute(query: Query): Promise<{ query: Query; success: boolean; tweets?: Tweet[]; error?: string }> {
    const state = this.queryStates.get(query.id);
    if (!state) {
      return { query, success: false, error: 'Query not registered' };
    }

    try {
      this.recordRequest();
      const tweets = await this.requestFn(query);
      state.consecutiveFailures = 0;
      state.totalRuns++;
      state.lastRunAt = new Date();

      const baseCooldown = this.baseIntervals[query.priority];
      const cooldownMs = this.applyJitter(baseCooldown);
      state.cooldownUntil = new Date(Date.now() + cooldownMs);

      return { query, success: true, tweets };
    } catch (err) {
      state.consecutiveFailures++;
      const backoff = Math.min(
        this.baseIntervals[query.priority] * Math.pow(2, state.consecutiveFailures),
        this.options.maxBackoffMs!
      );
      state.cooldownUntil = new Date(Date.now() + backoff);
      return {
        query,
        success: false,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  async runContinuously(
    onResult: (result: { query: Query; success: boolean; tweets?: Tweet[]; error?: string }) => Promise<void>,
    onIdle?: () => void
  ): Promise<void> {
    while (true) {
      const query = await this.nextQuery();
      if (!query) {
        if (onIdle) onIdle();
        await this.sleep(60000);
        continue;
      }
      const result = await this.execute(query);
      await onResult(result);
      await this.sleep(2000 + Math.random() * 3000);
    }
  }

  private async waitForRateLimitHeadroom(): Promise<void> {
    const now = Date.now();
    this.requestHistory = this.requestHistory.filter(
      r => now - r.timestamp < this.windowMs
    );

    if (this.requestHistory.length >= this.maxRequestsPerWindow) {
      const oldestRequest = this.requestHistory[0];
      const waitTime = this.windowMs - (now - oldestRequest.timestamp);
      if (waitTime > 0) {
        console.log(`[Rotator] Rate limit approaching, waiting ${Math.ceil(waitTime / 1000)}s`);
        await this.sleep(waitTime + 1000);
      }
    }
  }

  private recordRequest(): void {
    this.requestHistory.push({ timestamp: Date.now() });
  }

  private calculateJitter(priority: number): number {
    const baseInterval = this.baseIntervals[priority];
    const jitterAmount = baseInterval * (this.options.jitterPercent! * Math.random());
    return Math.max(0, jitterAmount - baseInterval * this.options.jitterPercent! / 2);
  }

  private applyJitter(interval: number): number {
    const jitterAmount = interval * (this.options.jitterPercent! * Math.random());
    return interval + jitterAmount;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
