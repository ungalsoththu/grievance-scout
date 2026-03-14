import { describe, it, expect } from 'bun:test';
import { KeywordCategorizer } from '../../src/classify/llm-categorizer';

describe('Categorizer', () => {
  const categories = ['route_issue', 'delay', 'staff_behavior', 'infrastructure', 'fares'];

  it('should categorize route issues by keywords', () => {
    const categorizer = new KeywordCategorizer();
    const result = categorizer.categorize({
      id: 'c1',
      content: 'Bus 23B route changed without notice',
      complainantHandle: 'user'
    }, categories);
    expect(result.category).toBe('route_issue');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should categorize staff behavior issues', () => {
    const categorizer = new KeywordCategorizer();
    const result = categorizer.categorize({
      id: 'c2',
      content: 'Driver was rude and unprofessional',
      complainantHandle: 'user'
    }, categories);
    expect(result.category).toBe('staff_behavior');
  });

  it('should detect escalated complaints', () => {
    const categorizer = new KeywordCategorizer();
    const result = categorizer.categorize({
      id: 'c3',
      content: 'This is pathetic! I have complained 5 times and nothing is resolved!',
      complainantHandle: 'angry_user'
    }, categories);
    expect(result.isEscalated).toBe(true);
  });

  it('should handle unknown content gracefully', () => {
    const categorizer = new KeywordCategorizer();
    const result = categorizer.categorize({
      id: 'c4',
      content: 'Something happened today',
      complainantHandle: 'user'
    }, categories);
    expect(result.category).toBe('other');
    expect(result.confidence).toBeGreaterThan(0);
  });
});
