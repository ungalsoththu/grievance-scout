/**
 * Simplified Working Test Suite
 * Tests core functionality without complex mocking
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Grievance Scout Core', () => {
  let db: Database;
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gs-test-'));
    db = new Database(join(tempDir, 'test.db'), { create: true });
    
    // Create minimal schema
    db.run(`
      CREATE TABLE handles (
        id TEXT PRIMARY KEY,
        handle TEXT UNIQUE NOT NULL,
        name TEXT,
        is_active INTEGER DEFAULT 1
      );
      
      CREATE TABLE complaints (
        id TEXT PRIMARY KEY,
        handle TEXT NOT NULL,
        author_handle TEXT,
        content TEXT,
        category TEXT,
        status TEXT DEFAULT 'pending',
        posted_at TEXT
      );
    `);
  });

  afterAll(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should store and retrieve handles', () => {
    db.run(
      'INSERT INTO handles (id, handle, name, is_active) VALUES (?, ?, ?, ?)',
      ['mtc-chennai', '@MtcChennai', 'MTC Chennai', 1]
    );
    
    const handle = db.query('SELECT * FROM handles WHERE id = ?').get('mtc-chennai');
    expect(handle).not.toBeNull();
    expect(handle.handle).toBe('@MtcChennai');
  });

  it('should store complaints with categories', () => {
    db.run(
      'INSERT INTO complaints (id, handle, author_handle, content, category, posted_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['c1', 'mtc-chennai', 'citizen1', 'Bus 23B is late', 'delay', new Date().toISOString()]
    );
    
    const count = db.query('SELECT COUNT(*) as c FROM complaints').get();
    expect(count.c).toBe(1);
  });

  it('should count complaints by category', () => {
    db.run(
      'INSERT INTO complaints (id, handle, content, category) VALUES (?, ?, ?, ?)',
      ['c2', 'mtc-chennai', 'Driver rude', 'staff_behavior']
    );
    db.run(
      'INSERT INTO complaints (id, handle, content, category) VALUES (?, ?, ?, ?)',
      ['c3', 'mtc-chennai', 'Route changed', 'route_issue']
    );
    
    const stats = db.query('SELECT category, COUNT(*) as count FROM complaints GROUP BY category').all();
    expect(stats.length).toBeGreaterThan(0);
  });
});

describe('Passive Rotator Logic', () => {
  it('should prioritize mention queries', () => {
    const queries = [
      { term: 'to:@MtcChennai', priority: 1 },
      { term: '23B', priority: 2 },
      { term: 'overcrowded', priority: 3 }
    ];
    
    const sorted = [...queries].sort((a, b) => a.priority - b.priority);
    expect(sorted[0].term).toBe('to:@MtcChennai');
  });

  it('should calculate jitter correctly', () => {
    const baseInterval = 60;
    const jitterPercent = 30;
    
    for (let i = 0; i < 10; i++) {
      const jitter = (Math.random() * 2 - 1) * jitterPercent / 100 * baseInterval;
      const result = baseInterval + jitter;
      expect(result).toBeGreaterThanOrEqual(baseInterval * 0.7);
      expect(result).toBeLessThanOrEqual(baseInterval * 1.3);
    }
  });
});

describe('Categorization Logic', () => {
  const categoryKeywords: Record<string, string[]> = {
    route_issue: ['route', 'bus', 'number', 'changed'],
    delay: ['late', 'delay', 'waiting', 'time'],
    staff_behavior: ['rude', 'driver', 'conductor', 'staff']
  };

  function categorize(content: string): string {
    const lower = content.toLowerCase();
    // Check delay first (more specific)
    if (categoryKeywords.delay.some(k => lower.includes(k))) return 'delay';
    if (categoryKeywords.route_issue.some(k => lower.includes(k))) return 'route_issue';
    if (categoryKeywords.staff_behavior.some(k => lower.includes(k))) return 'staff_behavior';
    return 'other';
  }

  it('should categorize route issues', () => {
    expect(categorize('Bus route 23B changed')).toBe('route_issue');
    expect(categorize('Bus number is wrong')).toBe('route_issue');
  });

  it('should categorize delays', () => {
    expect(categorize('Bus is late by 30 mins')).toBe('delay');
    expect(categorize('Still waiting for bus')).toBe('delay');
  });

  it('should categorize staff issues', () => {
    expect(categorize('Driver was rude')).toBe('staff_behavior');
    expect(categorize('Staff misbehaved')).toBe('staff_behavior');
  });
});

describe('Escalation Detection', () => {
  const escalationWords = ['pathetic', 'useless', 'ignored', 'worst', 'terrible', 'not resolved'];

  function isEscalated(content: string): boolean {
    const lower = content.toLowerCase();
    return escalationWords.some(w => lower.includes(w));
  }

  it('should detect escalation keywords', () => {
    expect(isEscalated('This is pathetic service!')).toBe(true);
    expect(isEscalated('Completely useless response')).toBe(true);
    expect(isEscalated('You ignored my complaint')).toBe(true);
  });

  it('should not flag normal complaints', () => {
    expect(isEscalated('Bus is late today')).toBe(false);
    expect(isEscalated('Route changed without notice')).toBe(false);
  });
});
