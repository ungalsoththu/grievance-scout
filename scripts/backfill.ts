#!/usr/bin/env bun
/**
 * Historical Backfill Script
 * Recovers historical data by time-slicing searches
 * Overcomes Twitter's ~7 day search limitation
 */

import { Command } from 'commander';
import { getDefaultAdapter } from '../src/db/factory';
import { PassiveRotator, type Query } from '../src/search/passive-rotator';
import { TwitterClient } from '../src/search/twitter-client';
import { LLMCategorizer } from '../src/classify/llm-categorizer';
import { format, subDays } from 'date-fns';

const program = new Command();

interface BackfillOptions {
  handle: string;
  days: string;
  terms?: string;
  dryRun?: boolean;
}

async function runBackfill(options: BackfillOptions) {
  const days = parseInt(options.days);
  if (isNaN(days) || days <= 0 || days > 365) {
    console.error('Days must be between 1 and 365');
    process.exit(1);
  }

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     Historical Backfill (Passive Mode)                       ║');
  console.log(`║     Target: ${days.toString().padEnd(3)} days of history` + ' '.repeat(27 - days.toString().length) + '║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const db = await getDefaultAdapter();
  const client = new TwitterClient();

  // Get handle config
  const handle = await db.getHandleById(options.handle);
  if (!handle) {
    console.error(`Handle not found: ${options.handle}`);
    console.log('Run audit first to initialize handle, or use a handle that exists in config.');
    process.exit(1);
  }

  if (!handle.searchConfig.backfillEnabled) {
    console.log(`Backfill disabled for ${handle.handle}. Enable in searchConfig.`);
    await db.close();
    return;
  }

  // Get search terms
  let terms = await db.getSearchTerms(handle.id);
  
  // Filter to top performing terms if too many
  if (terms.length > 10) {
    terms = terms
      .sort((a, b) => b.hitCount - a.hitCount)
      .slice(0, 10);
    console.log(`Using top ${terms.length} search terms by hit count`);
  }

  // Build time-sliced queries
  const queries: Query[] = [];
  const now = new Date();
  const chunkSize = 6; // Under 7 day limit
  const chunks = Math.ceil(days / chunkSize);

  console.log(`\nBuilding ${chunks} time chunks (${chunkSize} days each)`);
  console.log(`Terms: ${terms.map(t => t.term).join(', ')}\n`);

  for (let i = 0; i < chunks; i++) {
    const endOffset = i * chunkSize;
    const startOffset = Math.min(endOffset + chunkSize, days);

    const until = subDays(now, endOffset);
    const since = subDays(now, startOffset);

    for (const term of terms) {
      const queryStr = `${term.term} since:${format(since, 'yyyy-MM-dd')} until:${format(until, 'yyyy-MM-dd')}`;
      queries.push({
        id: `backfill-${handle.id}-${term.id}-${i}`,
        query: term.term,
        termType: 'timeslice',
        handle: handle.id,
        priority: 4 // Lowest priority for backfill
      });
    }
  }

  console.log(`Total backfill queries: ${queries.length}`);
  console.log(`Estimated time: ${Math.ceil(queries.length * 30 / 60)}+ hours (30 min per query)\n`);
  console.log('Starting passive execution...\n');

  // Set up passive rotator with extra-long cooldown for backfill
  const rotator = new PassiveRotator(
    async (query) => {
      const term = terms.find(t => t.id === query.id.split('-')[2]);
      if (!term) return [];

      const chunkIndex = parseInt(query.id.split('-')[3]);
      const endOffset = chunkIndex * chunkSize;
      const startOffset = Math.min(endOffset + chunkSize, days);
      const until = subDays(now, endOffset);
      const since = subDays(now, startOffset);

      const searchQuery = `${term.term} since:${format(since, 'yyyy-MM-dd')} until:${format(until, 'yyyy-MM-dd')}`;
      
      console.log(`[Backfill] ${format(since, 'yyyy-MM-dd')} to ${format(until, 'yyyy-MM-dd')} | "${term.term}"`);
      
      try {
        // Direct search with time slice
        const { stdout } = await Bun.spawn([
          'bird', 'search', searchQuery, '--json', '--limit', '100'
        ]).text();
        
        const tweets = JSON.parse(stdout || '[]');
        console.log(`  Found ${tweets.length} tweets`);
        
        return tweets.map((t: any) => ({
          id: t.id || t.id_str,
          url: t.url || `https://twitter.com/i/web/status/${t.id}`,
          content: t.text || t.full_text,
          authorHandle: t.user?.screen_name || t.username,
          authorName: t.user?.name,
          postedAt: new Date(t.created_at || t.date),
          inReplyToId: t.in_reply_to_status_id_str
        }));
      } catch (err) {
        console.error(`  Error: ${(err as Error).message}`);
        throw err;
      }
    },
    {
      jitterPercent: 0.30,
      maxBackoffMs: 24 * 60 * 60 * 1000
    }
  );

  rotator.addQueries(queries);

  const categorizer = new LLMCategorizer();
  let totalFound = 0;
  let totalNew = 0;

  // Run with long timeout (backfill takes days potentially)
  const startTime = Date.now();
  const maxRuntimeHours = 8; // Run for max 8 hours per invocation

  try {
    await rotator.runContinuously(
      async (result) => {
        if (!result.success || !result.tweets) return;

        for (const tweet of result.tweets) {
          totalFound++;

          // Check if already exists
          const existing = await db.getComplaintById(tweet.id);
          if (existing) continue;

          if (options.dryRun) {
            console.log(`  [DRY RUN] Would add: ${tweet.content.substring(0, 50)}...`);
            continue;
          }

          const categorization = await categorizer.categorize(
            {
              id: tweet.id,
              handle: handle.id,
              authorHandle: tweet.authorHandle,
              authorName: tweet.authorName,
              tweetUrl: tweet.url,
              content: tweet.content,
              postedAt: tweet.postedAt,
              isEscalated: false,
              status: 'pending',
              firstSeenAt: new Date(),
              lastCheckedAt: new Date()
            },
            handle.categories,
            handle.escalationRules.escalationKeywords
          );

          await db.upsertComplaint({
            id: tweet.id,
            handle: handle.id,
            authorHandle: tweet.authorHandle,
            authorName: tweet.authorName,
            tweetUrl: tweet.url,
            content: tweet.content,
            postedAt: tweet.postedAt,
            category: categorization.category,
            sentiment: categorization.sentiment,
            isEscalated: categorization.isEscalated,
            escalationReason: categorization.escalationReason,
            status: 'pending',
            firstSeenAt: new Date(),
            lastCheckedAt: new Date()
          });

          totalNew++;
        }

        // Check max runtime
        const hoursRunning = (Date.now() - startTime) / (1000 * 60 * 60);
        if (hoursRunning > maxRuntimeHours) {
          throw new Error('TIMEOUT');
        }
      },
      () => {
        console.log('[Backfill] Waiting for next available query slot...');
      }
    );
  } catch (err) {
    if ((err as Error).message === 'TIMEOUT') {
      console.log(`\nMax runtime reached (${maxRuntimeHours} hours)`);
    }
  }

  console.log(`\n✓ Backfill complete`);
  console.log(`  Total found: ${totalFound}`);
  console.log(`  New complaints: ${totalNew}`);
  console.log(`\nRun again to continue backfilling remaining chunks.`);

  await db.close();
}

program
  .name('backfill')
  .description('Historical data recovery with time-sliced searches')
  .requiredOption('-h, --handle <handle>', 'Handle ID to backfill')
  .option('-d, --days <days>', 'Days to backfill (max 365)', '30')
  .option('--dry-run', 'Find only, do not save')
  .action(runBackfill);

program.parse();
