import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { BunSQLiteAdapter } from '../../src/db/sqlite-bun';
import { createTempDir, cleanupTempDir, createTestHandle } from '../config';

describe('Database Adapter', () => {
  let adapter: BunSQLiteAdapter;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = createTempDir();
    adapter = new BunSQLiteAdapter({ path: `${tempDir}/test.db`, create: true });
    await adapter.connect();
    await adapter.runMigrations();
  });

  afterEach(async () => {
    await adapter?.close();
    cleanupTempDir(tempDir);
  });

  describe('Handle Management', () => {
    it('should save and retrieve a handle', async () => {
      const handle = createTestHandle('test-1');
      await adapter.saveHandle(handle);
      const retrieved = await adapter.getHandleById('test-1');
      expect(retrieved?.handle).toBe('@TestHandle');
    });

    it('should list active handles only', async () => {
      await adapter.saveHandle({ ...createTestHandle('active-1'), isActive: true });
      await adapter.saveHandle({ ...createTestHandle('inactive'), isActive: false });
      const active = await adapter.getActiveHandles();
      expect(active.length).toBe(1);
    });
  });

  describe('Complaint Management', () => {
    beforeEach(async () => {
      await adapter.saveHandle(createTestHandle('complaint-test'));
    });

    it('should save a complaint', async () => {
      const complaint = {
        id: 'c1',
        handle: 'complaint-test',
        tweetUrl: 'https://twitter.com/citizen/status/1',
        complainantHandle: 'citizen',
        postedAt: new Date(),
        content: 'Bus is late',
        category: 'delay',
        isEscalated: false,
        status: 'pending' as const
      };
      await adapter.saveComplaint(complaint);
      const retrieved = await adapter.getComplaintById('c1');
      expect(retrieved?.content).toBe('Bus is late');
    });
  });
});
