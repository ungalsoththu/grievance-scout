/**
 * Term Discovery Engine
 * Extracts new search terms from existing complaint data
 * Improves coverage over time through recursive enrichment
 */

import type { DatabaseAdapter } from '../db/interface';

export interface DiscoveryResult {
  newRoutes: number;
  newStops: number;
  newKeywords: number;
  terms: Array<{
    term: string;
    type: 'route' | 'stop' | 'keyword';
    confidence: number;
  }>;
}

export class TermDiscoveryEngine {
  constructor(private db: DatabaseAdapter) {}

  /**
   * Discover new search terms from existing complaints
   * Run this periodically to expand search coverage
   */
  async discover(handle: string): Promise<DiscoveryResult> {
    console.log(`[TermDiscovery] Analyzing data for ${handle}...`);

    // Extract patterns
    const routes = await this.db.extractTopRoutes(handle, 20);
    const stops = await this.db.extractTopStops(handle, 20);
    const keywords = await this.db.extractFrequentKeywords(handle, 30);

    // Filter out existing terms
    const existingTerms = await this.db.getSearchTerms(handle);
    const existingSet = new Set(existingTerms.map(t => `${t.termType}:${t.term}`));

    const newTerms: DiscoveryResult['terms'] = [];
    let newRoutes = 0;
    let newStops = 0;
    let newKeywords = 0;

    // Process routes
    for (const route of routes) {
      const key = `route:${route}`;
      if (!existingSet.has(key)) {
        await this.db.addSearchTerm({
          handle,
          term: route,
          termType: 'route',
          source: 'extracted',
          confidence: this.calculateRouteConfidence(route),
          hitCount: 0
        });
        newTerms.push({ term: route, type: 'route', confidence: 0.8 });
        newRoutes++;
      }
    }

    // Process stops
    for (const stop of stops) {
      const key = `stop:${stop}`;
      if (!existingSet.has(key) && stop.length > 3) {
        await this.db.addSearchTerm({
          handle,
          term: stop,
          termType: 'stop',
          source: 'extracted',
          confidence: this.calculateStopConfidence(stop),
          hitCount: 0
        });
        newTerms.push({ term: stop, type: 'stop', confidence: 0.7 });
        newStops++;
      }
    }

    // Process keywords (complaint language)
    for (const keyword of keywords) {
      const key = `keyword:${keyword}`;
      if (!existingSet.has(key) && this.isUsefulKeyword(keyword)) {
        await this.db.addSearchTerm({
          handle,
          term: keyword,
          termType: 'keyword',
          source: 'extracted',
          confidence: 0.6,
          hitCount: 0
        });
        newTerms.push({ term: keyword, type: 'keyword', confidence: 0.6 });
        newKeywords++;
      }
    }

    console.log(`[TermDiscovery] Found ${newRoutes} routes, ${newStops} stops, ${newKeywords} keywords`);

    return {
      newRoutes,
      newStops,
      newKeywords,
      terms: newTerms
    };
  }

  /**
   * Build backfill queries for historical data
   * Creates time-sliced queries to overcome 7-day search limit
   */
  async buildBackfillQueries(
    handle: string,
    daysBack: number,
    terms: string[]
  ): Promise<Array<{
    id: string;
    query: string;
    since: Date;
    until: Date;
  }>> {
    const queries: Array<{
      id: string;
      query: string;
      since: Date;
      until: Date;
    }> = [];

    const now = new Date();
    const chunkSize = 6; // Days per chunk (under 7-day limit)
    const chunks = Math.ceil(daysBack / chunkSize);

    for (let i = 0; i < chunks; i++) {
      const endOffset = i * chunkSize;
      const startOffset = Math.min(endOffset + chunkSize, daysBack);

      const until = new Date(now);
      until.setDate(until.getDate() - endOffset);

      const since = new Date(now);
      since.setDate(since.getDate() - startOffset);

      // Create queries for each term in this time window
      for (const term of terms.slice(0, 5)) { // Limit terms per window
        const query = `${term} since:${this.formatDate(since)} until:${this.formatDate(until)}`;
        queries.push({
          id: `backfill-${handle}-${term}-${i}`,
          query,
          since,
          until
        });
      }
    }

    return queries;
  }

  private calculateRouteConfidence(route: string): number {
    // Pure number routes are higher confidence
    if (/^\d{1,3}$/.test(route)) return 0.9;
    // Number + letter (like 23B, 51D)
    if (/^\d{1,3}[A-Z]$/.test(route)) return 0.85;
    // Letter + number
    if (/^[A-Z]\d{2,3}$/.test(route)) return 0.8;
    return 0.7;
  }

  private calculateStopConfidence(stop: string): number {
    // Multi-word stops are higher confidence
    const words = stop.split(/\s+/).length;
    if (words >= 3) return 0.85;
    if (words === 2) return 0.75;
    return 0.6;
  }

  private isUsefulKeyword(keyword: string): boolean {
    // Filter out noise words
    const noiseWords = new Set([
      'twitter', 'tweet', 'post', 'today', 'yesterday', 'tomorrow',
      'morning', 'evening', 'night', 'time', 'hour', 'minute',
      'people', 'person', 'someone', 'anyone', 'everyone'
    ]);
    return !noiseWords.has(keyword.toLowerCase());
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}
