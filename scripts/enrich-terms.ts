#!/usr/bin/env bun
/**
 * Term Enrichment Script
 * Extracts new search terms from existing complaint data
 */

import { Command } from 'commander';
import { getDefaultAdapter } from '../src/db/factory';
import { TermDiscoveryEngine } from '../src/search/term-discovery';

const program = new Command();

interface EnrichOptions {
  handle?: string;
  dryRun?: boolean;
}

async function enrichTerms(options: EnrichOptions) {
  console.log('Term Discovery - Extracting patterns from existing data\n');

  const db = await getDefaultAdapter();
  const discovery = new TermDiscoveryEngine(db);

  // Get all active handles
  let handles = await db.getActiveHandles();
  
  if (options.handle) {
    const filtered = handles.filter(h => h.id === options.handle || h.handle === options.handle);
    if (filtered.length === 0) {
      console.error(`Handle not found: ${options.handle}`);
      process.exit(1);
    }
    handles = filtered;
  }

  console.log(`Processing ${handles.length} handle(s):\n`);

  for (const handle of handles) {
    console.log(`[${handle.handle}] Analyzing complaint data...`);
    
    // Get stats before
    const beforeTerms = await db.getSearchTerms(handle.id);
    console.log(`  Current terms: ${beforeTerms.length}`);

    // Run discovery
    const result = await discovery.discover(handle.id);
    
    console.log(`\n  Discovery results:`);
    console.log(`    + ${result.newRoutes} route numbers`);
    console.log(`    + ${result.newStops} stop names`);
    console.log(`    + ${result.newKeywords} keywords`);
    
    if (result.terms.length > 0) {
      console.log(`\n  New terms added:`);
      for (const term of result.terms.slice(0, 10)) {
        console.log(`    - ${term.term} (${term.type}, confidence: ${(term.confidence * 100).toFixed(0)}%)`);
      }
      if (result.terms.length > 10) {
        console.log(`    ... and ${result.terms.length - 10} more`);
      }
    }
    
    // Get stats after
    const afterTerms = await db.getSearchTerms(handle.id);
    console.log(`\n  Total terms now: ${afterTerms.length}\n`);
  }

  await db.close();
  console.log('Enrichment complete. Run audit to use new terms.');
}

program
  .name('enrich-terms')
  .description('Discover new search terms from existing data')
  .option('-h, --handle <handle>', 'Specific handle to enrich')
  .option('--dry-run', 'Show what would be added without saving')
  .action(enrichTerms);

program.parse();
