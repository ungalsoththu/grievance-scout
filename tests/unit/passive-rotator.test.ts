import { describe, it, expect } from 'bun:test';
import { PassiveRotator, type SearchQuery } from '../../src/search/passive-rotator';

describe('Passive Rotator', () => {
  const mockQueries: SearchQuery[] = [
    { term: 'to:@MtcChennai', termType: 'mention', handle: 'mtc-chennai', priority: 1 },
    { term: '23B', termType: 'route', handle: 'mtc-chennai', priority: 2 },
    { term: 'overcrowded', termType: 'keyword', handle: 'mtc-chennai', priority: 3 }
  ];

  it('should rotate queries in priority order', () => {
    const rotator = new PassiveRotator(mockQueries, { maxRequestsPerWindow: 10, windowMinutes: 15 });
    const next = rotator.getNextQuery();
    expect(next?.priority).toBe(1);
    expect(next?.term).toBe('to:@MtcChennai');
  });

  it('should mark queries as completed', () => {
    const rotator = new PassiveRotator(mockQueries, { maxRequestsPerWindow: 10 });
    rotator.markCompleted('to:@MtcChennai', { success: true, tweetsFound: 5 });
    const stats = rotator.getQueryStats('to:@MtcChennai');
    expect(stats?.successCount).toBe(1);
    expect(stats?.tweetsFound).toBe(5);
  });

  it('should track failures for backoff', () => {
    const rotator = new PassiveRotator(mockQueries, { maxRequestsPerWindow: 10 });
    rotator.markCompleted('to:@MtcChennai', { success: false });
    const stats = rotator.getQueryStats('to:@MtcChennai');
    expect(stats?.failCount).toBe(1);
    expect(stats?.consecutiveFails).toBe(1);
  });

  it('should calculate next run time with jitter', () => {
    const rotator = new PassiveRotator(mockQueries, {
      maxRequestsPerWindow: 10,
      windowMinutes: 15,
      baseIntervalSeconds: 60,
      jitterPercent: 30
    });
    
    const baseInterval = 60;
    const jitterMin = baseInterval * 0.7;
    const jitterMax = baseInterval * 1.3;
    
    // Get multiple samples to verify jitter range
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const time = rotator.calculateNextRunTime(60, 1);
      times.push(time);
    }
    
    expect(times.every(t => t >= jitterMin && t <= jitterMax)).toBe(true);
  });

  it('should be in cooldown after too many requests', () => {
    const rotator = new PassiveRotator(mockQueries, { maxRequestsPerWindow: 2, windowMinutes: 15 });
    rotator.markCompleted('to:@MtcChennai', { success: true });
    rotator.markCompleted('23B', { success: true });
    expect(rotator.isInCooldown()).toBe(true);
  });

  it('should return null when all queries exhausted', () => {
    const rotator = new PassiveRotator(mockQueries.slice(0, 1), { maxRequestsPerWindow: 10 });
    rotator.markCompleted('to:@MtcChennai', { success: true });
    const next = rotator.getNextQuery();
    expect(next).toBeNull();
  });

  it('should reset after window expires', () => {
    const rotator = new PassiveRotator(mockQueries, {
      maxRequestsPerWindow: 1,
      windowMinutes: 0.001 // 0.06 seconds for testing
    });
    
    rotator.markCompleted('to:@MtcChennai', { success: true });
    expect(rotator.isInCooldown()).toBe(true);
    
    // Wait for window to expire
    setTimeout(() => {
      const next = rotator.getNextQuery();
      expect(next).not.toBeNull();
    }, 100);
  });
});
