#!/usr/bin/env bun
/**
 * Initialization Script
 * Sets up database and initial search terms for MTC Chennai
 */

import { getDefaultAdapter } from '../src/db/factory';

async function init() {
  console.log('Initializing Social Grievance Audit System...\n');

  const db = await getDefaultAdapter();
  console.log('✓ Database connected');

  // Check if MTC Chennai handle exists
  const existing = await db.getHandleById('mtc-chennai');
  
  if (existing) {
    console.log('Handle @MtcChennai already configured');
  } else {
    console.log('Adding @MtcChennai to database...');
    
    // Insert handle directly (would normally go through proper API)
    // For now, user should add via config/handles.json
    console.log('Please ensure config/handles.json is properly configured');
  }

  // Add initial search terms for MTC
  const initialTerms = [
    // Major bus routes in Chennai
    { term: '23B', type: 'route' as const, confidence: 0.9 },
    { term: '51D', type: 'route' as const, confidence: 0.9 },
    { term: '21G', type: 'route' as const, confidence: 0.9 },
    { term: '1B', type: 'route' as const, confidence: 0.9 },
    { term: '2A', type: 'route' as const, confidence: 0.9 },
    { term: 'M147', type: 'route' as const, confidence: 0.85 },
    { term: '570', type: 'route' as const, confidence: 0.9 },
    { term: '588', type: 'route' as const, confidence: 0.9 },
    
    // Major stops/terminals
    { term: 'T Nagar', type: 'stop' as const, confidence: 0.8 },
    { term: 'Central Railway Station', type: 'stop' as const, confidence: 0.8 },
    { term: 'CMBT', type: 'stop' as const, confidence: 0.85 },
    { term: 'Broadway', type: 'stop' as const, confidence: 0.8 },
    { term: 'High Court', type: 'stop' as const, confidence: 0.75 },
    { term: 'Anna Nagar', type: 'stop' as const, confidence: 0.75 },
    { term: 'Adyar', type: 'stop' as const, confidence: 0.75 },
    { term: 'Velachery', type: 'stop' as const, confidence: 0.75 },
    
    // Complaint keywords
    { term: 'late', type: 'keyword' as const, confidence: 0.6 },
    { term: 'delay', type: 'keyword' as const, confidence: 0.6 },
    { term: 'crowded', type: 'keyword' as const, confidence: 0.6 },
    { term: 'overcrowded', type: 'keyword' as const, confidence: 0.7 },
    { term: 'rude driver', type: 'keyword' as const, confidence: 0.7 },
    { term: 'conductor', type: 'keyword' as const, confidence: 0.6 },
    { term: 'breakdown', type: 'keyword' as const, confidence: 0.7 },
    { term: 'no bus', type: 'keyword' as const, confidence: 0.7 },
    { term: 'wrong route', type: 'keyword' as const, confidence: 0.7 },
    { term: 'overcharged', type: 'keyword' as const, confidence: 0.7 },
    { term: 'fare', type: 'keyword' as const, confidence: 0.5 },
    { term: 'dirty', type: 'keyword' as const, confidence: 0.6 },
    { term: 'unsafe', type: 'keyword' as const, confidence: 0.7 },
    { term: 'speeding', type: 'keyword' as const, confidence: 0.7 },
    { term: 'accident', type: 'keyword' as const, confidence: 0.8 },
  ];

  console.log(`Adding ${initialTerms.length} initial search terms...`);

  let added = 0;
  let existingTerms = 0;

  for (const term of initialTerms) {
    try {
      await db.addSearchTerm({
        handle: 'mtc-chennai',
        term: term.term,
        termType: term.type,
        source: 'manual',
        confidence: term.confidence,
        hitCount: 0
      });
      added++;
    } catch (err) {
      if ((err as Error).message.includes('UNIQUE')) {
        existingTerms++;
      } else {
        console.error(`Error adding ${term.term}:`, err);
      }
    }
  }

  console.log(`✓ Added ${added} new terms, ${existingTerms} already existed`);

  // Show current stats
  const allTerms = await db.getSearchTerms('mtc-chennai');
  console.log(`\nTotal search terms for @MtcChennai: ${allTerms.length}`);
  console.log(`  Routes: ${allTerms.filter(t => t.termType === 'route').length}`);
  console.log(`  Stops: ${allTerms.filter(t => t.termType === 'stop').length}`);
  console.log(`  Keywords: ${allTerms.filter(t => t.termType === 'keyword').length}`);

  await db.close();

  console.log('\n✓ Initialization complete!');
  console.log('\nNext steps:');
  console.log('  1. Ensure bird CLI is authenticated');
  console.log('  2. Run: bun run scripts/audit.ts --handle @MtcChennai');
  console.log('  3. Or run full audit: bun run scripts/audit.ts --agent-mode');
}

init().catch(err => {
  console.error('Initialization failed:', err);
  process.exit(1);
});
