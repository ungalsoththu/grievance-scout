import { describe, it, expect, beforeEach } from 'bun:test';
import { TermDiscovery } from '../../src/search/term-discovery';
import { BunSQLiteAdapter } from '../../src/db/sqlite-bun';
import { createTempDir, cleanupTempDir } from '../config';

describe('Term Discovery', () => {
  let adapter: BunSQLiteAdapter;
  let discovery: TermDiscovery;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = createTempDir();
    adapter = new BunSQLiteAdapter({ path: `${tempDir}/test.db`, create: true });
    await adapter.connect();
    await adapter.runMigrations();
    await adapter.saveHandle({
      id: 'test-handle',
      handle: '@TestHandle',
      name: 'Test',
      city: 'Test City',
      isActive: true,
      categories: ['route_issue'],
      escalationRules: { noResponseHours: 24, repeatComplaintThreshold: 3 }
    });
    discovery = new TermDiscovery(adapter);
  });

  it('should extract route numbers from complaints', async () => {
    await adapter.saveComplaint({
      id: 'c1',
      handle: 'test-handle',
      tweetUrl: 'url1',
      complainantHandle: 'user',
      postedAt: new Date(),
      content: 'Bus 23B is always late',
      category: 'route_issue',
      isEscalated: false,
      status: 'pending'
    });

    const newTerms = await discovery.discoverTerms('test-handle', 30);
    expect(newTerms.some(t => t.term === '23B' && t.termType === 'route')).toBe(true);
  });

  it('should extract stop names', async () => {
    await adapter.saveComplaint({
      id: 'c2',
      handle: 'test-handle',
      tweetUrl: 'url2',
      complainantHandle: 'user',
      postedAt: new Date(),
      content: 'At T Nagar Bus Stand, no buses for 1 hour',
      category: 'delay',
      isEscalated: false,
      status: 'pending'
    });

    const newTerms = await discovery.discoverTerms('test-handle', 30);
    const hasT Nagar = newTerms.some(t => t.term.toLowerCase().includes('nagar'));
    expect(hasT Nagar).toBe(true);
  });

  it('should not extract existing terms', async () => {
    await adapter.saveSearchTerm({
      handleId: 'test-handle',
      term: 'crowded',
      termType: 'keyword',
      confidence: 0.7,
      hitCount: 5,
      lastUsedAt: new Date(),
      createdAt: new Date()
    });

    await adapter.saveComplaint({
      id: 'c3',
      handle: 'test-handle',
      tweetUrl: 'url3',
      complainantHandle: 'user',
      postedAt: new Date(),
      content: 'Bus is crowded again',
      category: 'infrastructure',
      isEscalated: false,
      status: 'pending'
    });

    const newTerms = await discovery.discoverTerms('test-handle', 30);
    const hasCrowded = newTerms.some(t => t.term === 'crowded');
    expect(hasCrowded).toBe(false);
  });

  afterEach(async () => {
    await adapter?.close();
    cleanupTempDir(tempDir);
  });
});
