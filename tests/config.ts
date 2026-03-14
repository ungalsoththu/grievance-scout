/**
 * Test Configuration
 * Shared test utilities and mocks
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export const TEST_TIMEOUT = 30000;

/**
 * Create a temporary directory for tests
 */
export function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'grievance-scout-test-'));
}

/**
 * Clean up temp directory
 */
export function cleanupTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Sample test data
 */
export const sampleTweets = [
  {
    id: '1234567890',
    url: 'https://twitter.com/citizen1/status/1234567890',
    author: 'citizen1',
    content: 'Bus 23B is always late. Worst service!',
    postedAt: new Date('2026-03-10T10:00:00Z'),
    isReply: false,
    replyToId: null
  },
  {
    id: '1234567891',
    url: 'https://twitter.com/citizen2/status/1234567891',
    author: 'citizen2',
    content: 'Driver was very rude today on route 51D',
    postedAt: new Date('2026-03-10T11:30:00Z'),
    isReply: false,
    replyToId: null
  },
  {
    id: '1234567892',
    url: 'https://twitter.com/MtcChennai/status/1234567892',
    author: 'MtcChennai',
    content: '@citizen1 We apologize for the delay. Route 23B is being monitored.',
    postedAt: new Date('2026-03-10T12:00:00Z'),
    isReply: true,
    replyToId: '1234567890'
  }
];

export const sampleCategorized = {
  category: 'route_issue',
  confidence: 0.85,
  sentiment: 'negative',
  isEscalated: false,
  resolutionStatus: 'pending'
};

/**
 * Mock sleep for testing delays
 */
export function mockSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.min(ms, 10)));
}

/**
 * Generate test handle config
 */
export function createTestHandle(id = 'test-handle') {
  return {
    id,
    handle: '@TestHandle',
    name: 'Test Handle',
    city: 'Test City',
    isActive: true,
    categories: ['route_issue', 'delay', 'staff_behavior', 'infrastructure', 'fares', 'other'],
    escalationRules: {
      noResponseHours: 24,
      repeatComplaintThreshold: 3,
      escalationKeywords: ['ignored', 'not resolved', 'useless', 'pathetic']
    }
  };
}

/**
 * Wait for a condition with timeout
 */
export async function waitFor(
  condition: () => boolean,
  timeoutMs = 5000,
  intervalMs = 50
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Timeout waiting for condition');
}
