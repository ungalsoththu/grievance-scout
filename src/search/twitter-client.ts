/**
 * Twitter/X Client using bird CLI
 * Handles searching, result parsing, and normalization
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { Query, Tweet } from './passive-rotator';

const execAsync = promisify(exec);

export interface TwitterClientConfig {
  authToken?: string;
  ct0?: string;
  timeoutMs?: number;
}

export class TwitterClient {
  private config: Required<TwitterClientConfig>;

  constructor(config: TwitterClientConfig = {}) {
    this.config = {
      authToken: config.authToken || process.env.TWITTER_AUTH_TOKEN || '',
      ct0: config.ct0 || process.env.TWITTER_CT0 || '',
      timeoutMs: config.timeoutMs || 60000
    };
  }

  /**
   * Execute a search query using bird CLI
   */
  async search(query: Query): Promise<Tweet[]> {
    const searchQuery = this.buildSearchQuery(query);
    
    try {
      const { stdout, stderr } = await execAsync(
        `bird search "${searchQuery.replace(/"/g, '\\"')}" --json`,
        {
          timeout: this.config.timeoutMs,
          env: {
            ...process.env,
            TWITTER_AUTH_TOKEN: this.config.authToken,
            TWITTER_CT0: this.config.ct0
          }
        }
      );

      if (stderr && !stdout) {
        throw new Error(`bird search failed: ${stderr}`);
      }

      const results = this.parseBirdOutput(stdout);
      return results.map(r => this.normalizeTweet(r, query.handle));
    } catch (err) {
      if ((err as Error).message.includes('timeout')) {
        throw new Error('Search timeout - Twitter may be rate limiting');
      }
      throw err;
    }
  }

  /**
   * Get tweets FROM a specific handle (for responses)
   */
  async getUserTweets(handle: string, since?: Date): Promise<Tweet[]> {
    const fromHandle = handle.replace(/^@/, '');
    const sinceQuery = since ? ` since:${this.formatDate(since)}` : '';
    const query = `from:${fromHandle}${sinceQuery}`;

    try {
      const { stdout, stderr } = await execAsync(
        `bird search "${query}" --json`,
        {
          timeout: this.config.timeoutMs,
          env: {
            ...process.env,
            TWITTER_AUTH_TOKEN: this.config.authToken,
            TWITTER_CT0: this.config.ct0
          }
        }
      );

      if (stderr && !stdout) {
        throw new Error(`bird search failed: ${stderr}`);
      }

      const results = this.parseBirdOutput(stdout);
      return results.map(r => this.normalizeTweet(r, handle));
    } catch (err) {
      throw err;
    }
  }

  /**
   * Get conversation thread for a specific tweet
   */
  async getConversation(tweetId: string): Promise<Tweet[]> {
    try {
      const { stdout, stderr } = await execAsync(
        `bird thread ${tweetId} --json`,
        {
          timeout: this.config.timeoutMs,
          env: {
            ...process.env,
            TWITTER_AUTH_TOKEN: this.config.authToken,
            TWITTER_CT0: this.config.ct0
          }
        }
      );

      if (stderr && !stdout) {
        return []; // No thread available
      }

      const results = this.parseBirdOutput(stdout);
      return results.map(r => this.normalizeTweet(r, ''));
    } catch (err) {
      console.error(`[TwitterClient] Failed to get conversation for ${tweetId}:`, err);
      return [];
    }
  }

  /**
   * Check if bird CLI is available and authenticated
   */
  async checkHealth(): Promise<{ ok: boolean; error?: string }> {
    try {
      const { stdout } = await execAsync('bird --version', { timeout: 10000 });
      if (!stdout.includes('bird')) {
        return { ok: false, error: 'bird CLI not found' };
      }

      // Try a simple search to verify auth
      await execAsync('bird search "test" --limit 1', {
        timeout: 30000,
        env: {
          ...process.env,
          TWITTER_AUTH_TOKEN: this.config.authToken,
          TWITTER_CT0: this.config.ct0
        }
      });

      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private buildSearchQuery(query: Query): string {
    const cleanHandle = query.handle.replace(/^@/, '');
    
    switch (query.termType) {
      case 'mention':
        return `to:${cleanHandle}`;
      
      case 'route':
        return `${query.query} to:${cleanHandle}`;
      
      case 'stop':
        return `"${query.query}" to:${cleanHandle}`;
      
      case 'keyword':
        return `${query.query} ${cleanHandle}`;
      
      case 'timeslice':
        // Already includes since/until in query
        return query.query;
      
      default:
        return query.query;
    }
  }

  private parseBirdOutput(output: string): any[] {
    try {
      // bird CLI outputs JSON lines or array
      const trimmed = output.trim();
      if (!trimmed) return [];

      // Try parsing as array first
      if (trimmed.startsWith('[')) {
        return JSON.parse(trimmed);
      }

      // Parse as JSON lines
      return trimmed
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch (err) {
      console.error('[TwitterClient] Failed to parse bird output:', output.substring(0, 200));
      return [];
    }
  }

  private normalizeTweet(raw: any, defaultHandle: string): Tweet {
    const id = raw.id || raw.id_str || raw.tweet_id || '';
    const url = raw.url || `https://twitter.com/i/web/status/${id}`;
    const content = raw.text || raw.content || raw.full_text || '';
    const authorHandle = raw.user?.screen_name || raw.author?.handle || raw.username || '';
    const authorName = raw.user?.name || raw.author?.name || '';
    const postedAt = new Date(raw.created_at || raw.date || Date.now());
    const inReplyToId = raw.in_reply_to_status_id_str || raw.in_reply_to_id || null;

    return {
      id,
      url,
      content,
      authorHandle: authorHandle ? `@${authorHandle}` : '',
      authorName,
      postedAt,
      inReplyToId
    };
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}

/**
 * Create query pool for a handle based on search terms
 */
export function buildQueryPool(
  handle: string,
  terms: { routes: string[]; stops: string[]; keywords: string[] }
): Query[] {
  const queries: Query[] = [];

  // Priority 1: Mentions (always included)
  queries.push({
    id: `mention-${handle}`,
    query: `to:${handle}`,
    termType: 'mention',
    handle,
    priority: 1
  });

  // Priority 2: Routes
  for (const route of terms.routes.slice(0, 10)) {
    queries.push({
      id: `route-${handle}-${route}`,
      query: route,
      termType: 'route',
      handle,
      priority: 2
    });
  }

  // Priority 2: Stops
  for (const stop of terms.stops.slice(0, 10)) {
    queries.push({
      id: `stop-${handle}-${stop}`,
      query: stop,
      termType: 'stop',
      handle,
      priority: 2
    });
  }

  // Priority 3: Keywords
  for (const keyword of terms.keywords.slice(0, 10)) {
    queries.push({
      id: `keyword-${handle}-${keyword}`,
      query: keyword,
      termType: 'keyword',
      handle,
      priority: 3
    });
  }

  return queries;
}
