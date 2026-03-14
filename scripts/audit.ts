#!/usr/bin/env bun
/**
 * Social Grievance Audit Script
 * Main entry point for running audits on configured handles
 */

import { Command } from 'commander';
import { getDefaultAdapter, type DatabaseAdapter } from '../src/db/factory';
import { PassiveRotator, type Query, type Tweet } from '../src/search/passive-rotator';
import { TwitterClient, buildQueryPool } from '../src/search/twitter-client';
import { TermDiscoveryEngine } from '../src/search/term-discovery';
import { LLMCategorizer } from '../src/classify/llm-categorizer';
import { format, startOfWeek, endOfWeek } from 'date-fns';

const program = new Command();

interface AuditOptions {
  config?: string;
  handle?: string;
  days?: string;
  backfill?: boolean;
  dryRun?: boolean;
  agentMode?: boolean;
  emailReport?: boolean;
}

async function loadHandlesConfig(path: string): Promise<any> {
  const config = await import(path);
  return config.default || config;
}

async function runAudit(options: AuditOptions) {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     Social Grievance Audit - Multi-Handle Edition           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  const db = await getDefaultAdapter();

  const configPath = options.config || './config/handles.json';
  let handlesConfig: { handles: any[] };
  
  try {
    handlesConfig = await loadHandlesConfig(configPath);
  } catch (err) {
    handlesConfig = { handles: [] };
  }

  let handles = handlesConfig.handles.filter((h: any) => h.is_active !== false);
  
  if (options.handle) {
    handles = handles.filter((h: any) => h.handle === options.handle || h.id === options.handle);
  }

  console.log(`\nProcessing ${handles.length} handle(s)`);

  const client = new TwitterClient();
  const health = await client.checkHealth();
  if (!health.ok) {
    console.error(`Error: ${health.error}`);
    process.exit(1);
  }

  const discovery = new TermDiscoveryEngine(db);
  
  for (const handleConfig of handles) {
    if (handleConfig.searchConfig?.discoveryEnabled !== false) {
      const result = await discovery.discover(handleConfig.id);
      console.log(`[${handleConfig.handle}] Discovered: +${result.newRoutes} routes, +${result.newStops} stops`);
    }
  }

  const allQueries: Query[] = [];
  
  for (const handleConfig of handles) {
    const terms = await db.getSearchTerms(handleConfig.id);
    const queryPool = buildQueryPool(
      handleConfig.id,
      {
        routes: terms.filter(t => t.termType === 'route').map(t => t.term),
        stops: terms.filter(t => t.termType === 'stop').map(t => t.term),
        keywords: terms.filter(t => t.termType === 'keyword').map(t => t.term)
      }
    );
    allQueries.push(...queryPool);
  }

  console.log(`\nTotal queries: ${allQueries.length}`);

  const rotator = new PassiveRotator(async (query: Query) => {
    const tweets = await client.search(query);
    
    const terms = await db.getSearchTerms(query.handle);
    const matchingTerm = terms.find(t => t.term === query.query);
    if (matchingTerm) {
      await db.incrementTermHitCount(matchingTerm.id);
      await db.markTermUsed(matchingTerm.id);
    }
    
    return tweets;
  });

  rotator.addQueries(allQueries);

  const categorizer = new LLMCategorizer();
  let totalProcessed = 0;
  let totalNew = 0;

  const maxRuntimeMinutes = options.agentMode ? 30 : 10;
  const startTime = Date.now();

  await rotator.runContinuously(
    async (result) => {
      if (!result.success || !result.tweets || result.tweets.length === 0) {
        return;
      }

      const handleConfig = handles.find((h: any) => h.id === result.query.handle);
      if (!handleConfig) return;

      for (const tweet of result.tweets) {
        totalProcessed++;
        
        const isFromHandle = tweet.authorHandle.toLowerCase() === handleConfig.handle.toLowerCase();
        
        if (isFromHandle) {
          // Response from organization
          const existing = await db.getResponseById(tweet.id);
          if (existing) continue;

          await db.upsertResponse({
            id: tweet.id,
            handle: handleConfig.id,
            inReplyToId: tweet.inReplyToId,
            tweetUrl: tweet.url,
            content: tweet.content,
            postedAt: tweet.postedAt,
            responseTimeMinutes: undefined,
            isResolutionAttempt: false,
            firstSeenAt: new Date()
          });
        } else {
          // Complaint to organization
          const existing = await db.getComplaintById(tweet.id);
          if (existing) {
            await db.upsertComplaint({
              ...existing,
              lastCheckedAt: new Date()
            });
            continue;
          }

          const categorization = await categorizer.categorize(
            {
              id: tweet.id,
              handle: handleConfig.id,
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
            handleConfig.categories,
            handleConfig.escalationRules?.escalationKeywords || []
          );

          await db.upsertComplaint({
            id: tweet.id,
            handle: handleConfig.id,
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
      }

      // Check runtime limit
      if (Date.now() - startTime > maxRuntimeMinutes * 60 * 1000) {
        throw new Error('TIMEOUT');
      }
    },
    () => {
      console.log('[Rotator] All queries in cooldown, waiting...');
    }
  ).catch((err) => {
    if ((err as Error).message === 'TIMEOUT') {
      console.log(`\nRuntime limit reached (${maxRuntimeMinutes} min)`);
    } else {
      console.error('Audit error:', err);
    }
  });

  // Finalize and generate reports
  console.log(`\n✓ Audit complete: ${totalProcessed} processed, ${totalNew} new complaints`);

  if (options.agentMode) {
    await generateWeeklyReports(db, handles);
  }

  await db.close();
}

async function generateWeeklyReports(db: DatabaseAdapter, handles: any[]) {
  console.log('\nGenerating weekly reports...');
  
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 }); // Monday
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

  for (const handle of handles) {
    const stats = await db.getWeeklyStats(handle.id, weekStart);
    
    // Report generation would go here
    console.log(`  [${handle.handle}] ${stats.totalComplaints} complaints, ${(stats.responseRate * 100).toFixed(1)}% response rate`);
  }
}

// CLI setup
program
  .name('audit')
  .description('Run social grievance audit')
  .option('-c, --config <path>', 'Config file path')
  .option('-h, --handle <handle>', 'Single handle mode')
  .option('-d, --days <days>', 'Days to look back', '7')
  .option('--backfill', 'Enable historical backfill')
  .option('--dry-run', 'Fetch only, do not save')
  .option('--agent-mode', 'Run as scheduled agent (longer runtime, generate reports)')
  .option('--email-report', 'Email report on completion')
  .action(runAudit);

program.parse();
