import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { BunSQLiteAdapter } from '../../src/db/sqlite-bun';
import { PassiveRotator } from '../../src/search/passive-rotator';
import { createTempDir, cleanupTempDir } from '../config';

describe('Full Audit Integration', () => {
  let adapter: BunSQLiteAdapter;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = createTempDir();
    adapter = new BunSQLiteAdapter({ path: `${tempDir}/audit.db`, create: true });
    await adapter.connect();
    await adapter.runMigrations();
  });

  afterAll(async () => {
    await adapter?.close();
    cleanupTempDir(tempDir);
  });

  it('should perform complete audit cycle', async () => {
    // Setup handle
    await adapter.saveHandle({
      id: 'mtc-chennai',
      handle: '@MtcChennai',
      name: 'MTC Chennai',
      city: 'Chennai',
      isActive: true,
      categories: ['route_issue', 'delay', 'staff_behavior'],
      escalationRules: { noResponseHours: 48, repeatComplaintThreshold: 3 }
    });

    // Add search terms
    await adapter.saveSearchTerm({
      handleId: 'mtc-chennai',
      term: 'to:@MtcChennai',
      termType: 'mention',
      confidence: 1.0,
      hitCount: 0,
      createdAt: new Date()
    });

    // Create mock tweets
    const mockTweets = [
      {
        id: 't1',
        url: 'https://twitter.com/u1/status/t1',
        author: 'citizen1',
        content: '@MtcChennai Bus 23B late by 30 mins',
        postedAt: new Date(),
        isReply: false,
        replyToId: null
      },
      {
        id: 't2',
        url: 'https://twitter.com/u2/status/t2',
        author: 'citizen2',
        content: '@MtcChennai Driver rude today on 51D',
        postedAt: new Date(),
        isReply: false,
        replyToId: null
      },
      {
        id: 't3',
        url: 'https://twitter.com/MtcChennai/status/t3',
        author: 'MtcChennai',
        content: '@citizen1 We apologize. Route 23B is being monitored.',
        postedAt: new Date(Date.now() + 3600000), // 1 hour later
        isReply: true,
        replyToId: 't1'
      }
    ];

    // Simulate processing
    for (const tweet of mockTweets) {
      if (tweet.author.toLowerCase() === 'mtcchennai') {
        await adapter.saveResponse({
          id: tweet.id,
          tweetUrl: tweet.url,
          handle: 'mtc-chennai',
          postedAt: tweet.postedAt,
          content: tweet.content,
          inReplyToId: tweet.replyToId
        });
      } else {
        await adapter.saveComplaint({
          id: tweet.id,
          handle: 'mtc-chennai',
          tweetUrl: tweet.url,
          complainantHandle: tweet.author,
          postedAt: tweet.postedAt,
          content: tweet.content,
          category: 'delay',
          isEscalated: false,
          status: 'pending'
        });
      }
    }

    // Update complaint with response
    await adapter.linkResponseToComplaint('t1', 't3');

    // Verify results
    const complaints = await adapter.getComplaints({ handleId: 'mtc-chennai' });
    expect(complaints.length).toBe(2);

    const responded = complaints.filter(c => c.mtcResponseId);
    expect(responded.length).toBe(1);

    const stats = await adapter.getWeeklyStats('mtc-chennai', new Date());
    expect(stats.totalComplaints).toBe(2);
    expect(stats.totalResponses).toBe(1);
    expect(stats.responseRate).toBe(0.5);
  });
});
