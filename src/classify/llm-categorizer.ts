/**
 * LLM-Based Complaint Categorizer
 * Uses Zo API for classification when available
 * Falls back to keyword matching when not
 */

import type { Complaint } from '../db/interface';

export interface CategorizationResult {
  category: string;
  sentiment: 'negative' | 'neutral' | 'positive';
  isEscalated: boolean;
  escalationReason?: string;
}

export class LLMCategorizer {
  private useZoApi: boolean;

  constructor() {
    this.useZoApi = !!process.env.ZO_CLIENT_IDENTITY_TOKEN;
  }

  /**
   * Categorize a complaint using LLM or fallback
   */
  async categorize(
    complaint: Complaint,
    categories: string[],
    escalationKeywords: string[]
  ): Promise<CategorizationResult> {
    if (this.useZoApi) {
      try {
        return await this.categorizeWithZo(complaint, categories, escalationKeywords);
      } catch (err) {
        console.log('[Categorizer] Zo API failed, using fallback');
        return this.fallbackCategorize(complaint, categories, escalationKeywords);
      }
    }
    return this.fallbackCategorize(complaint, categories, escalationKeywords);
  }

  /**
   * Determine if a response is attempting resolution
   */
  async isResolutionAttempt(response: string, complaint: string): Promise<boolean> {
    if (this.useZoApi) {
      try {
        return await this.checkResolutionWithZo(response, complaint);
      } catch (err) {
        return this.fallbackResolutionCheck(response);
      }
    }
    return this.fallbackResolutionCheck(response);
  }

  private async categorizeWithZo(
    complaint: Complaint,
    categories: string[],
    escalationKeywords: string[]
  ): Promise<CategorizationResult> {
    const prompt = `
Analyze this complaint to MTC Chennai:
"""${complaint.content}"""

Available categories: ${categories.join(', ')}
Escalation keywords (indicate frustration): ${escalationKeywords.join(', ')}

Respond with ONLY a JSON object:
{
  "category": "one of the available categories",
  "sentiment": "negative|neutral|positive",
  "isEscalated": true|false,
  "escalationReason": "optional explanation if isEscalated is true"
}
`;

    const response = await this.callZoApi(prompt);
    
    try {
      const result = JSON.parse(response);
      return {
        category: result.category,
        sentiment: result.sentiment,
        isEscalated: result.isEscalated,
        escalationReason: result.escalationReason
      };
    } catch (err) {
      return this.fallbackCategorize(complaint, categories, escalationKeywords);
    }
  }

  private async checkResolutionWithZo(response: string, complaint: string): Promise<boolean> {
    const prompt = `
Is this response attempting to resolve the complaint?

Complaint: """${complaint}"""
Response: """${response}"""

Respond with ONLY "yes" or "no".
`;

    const result = await this.callZoApi(prompt);
    return result.toLowerCase().trim().startsWith('yes');
  }

  private async callZoApi(prompt: string): Promise<string> {
    const response = await fetch('https://api.zo.computer/zo/ask', {
      method: 'POST',
      headers: {
        'authorization': process.env.ZO_CLIENT_IDENTITY_TOKEN!,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        input: prompt,
        model_name: 'vercel:moonshotai/kimi-k2.5'
      })
    });

    if (!response.ok) {
      throw new Error(`Zo API error: ${response.status}`);
    }

    const data = await response.json();
    return data.output || '';
  }

  private fallbackCategorize(
    complaint: Complaint,
    categories: string[],
    escalationKeywords: string[]
  ): CategorizationResult {
    const content = complaint.content.toLowerCase();
    
    // Keyword-based category detection
    const categoryKeywords: Record<string, string[]> = {
      route_issue: ['route', 'number', 'bus no', 'wrong route', 'changed route'],
      fare_dispute: ['fare', 'ticket', 'price', 'cost', 'overcharged', 'change'],
      staff_behavior: ['driver', 'conductor', 'rude', 'behavior', 'attitude', 'shouting'],
      infrastructure: ['stop', 'shelter', 'bench', 'road', 'condition', 'broken'],
      breakdown: ['breakdown', 'stopped', 'engine', 'not moving', 'stuck'],
      delay: ['late', 'delay', 'waiting', 'time', 'schedule', 'punctuality'],
      safety: ['accident', 'dangerous', 'speeding', 'reckless', 'unsafe'],
      cleanliness: ['dirty', 'clean', 'hygiene', 'garbage', 'smell'],
      overcrowding: ['crowd', 'full', 'packed', 'standing', 'no seat', 'pushing']
    };

    let bestCategory = 'other';
    let maxScore = 0;

    for (const [cat, keywords] of Object.entries(categoryKeywords)) {
      const score = keywords.filter(k => content.includes(k)).length;
      if (score > maxScore && categories.includes(cat)) {
        maxScore = score;
        bestCategory = cat;
      }
    }

    // Sentiment detection
    const negativeWords = ['bad', 'terrible', 'worst', 'pathetic', 'horrible', 'disgusting', 'angry', 'frustrated'];
    const positiveWords = ['good', 'great', 'excellent', 'thank', 'appreciate', 'helpful'];
    
    const negativeCount = negativeWords.filter(w => content.includes(w)).length;
    const positiveCount = positiveWords.filter(w => content.includes(w)).length;
    
    let sentiment: 'negative' | 'neutral' | 'positive' = 'neutral';
    if (negativeCount > positiveCount) sentiment = 'negative';
    else if (positiveCount > negativeCount) sentiment = 'positive';

    // Escalation detection
    const isEscalated = escalationKeywords.some(k => content.includes(k.toLowerCase())) || 
                       (complaint.isEscalated || negativeCount >= 3);

    return {
      category: bestCategory,
      sentiment,
      isEscalated,
      escalationReason: isEscalated ? 'Contains escalation keywords or multiple negative indicators' : undefined
    };
  }

  private fallbackResolutionCheck(response: string): boolean {
    const resolutionIndicators = [
      'resolved', 'solved', 'fixed', 'taken care', 'looking into',
      'investigating', 'action', 'noted', 'forwarded', 'instructed',
      'will ensure', 'being done', 'arranged', 'provided'
    ];
    
    const content = response.toLowerCase();
    return resolutionIndicators.some(i => content.includes(i));
  }
}
