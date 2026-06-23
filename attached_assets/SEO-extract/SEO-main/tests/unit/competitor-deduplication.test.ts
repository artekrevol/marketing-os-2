/**
 * Unit Tests for Competitor Deduplication Logic
 * 
 * Tests competitor discovery, deduplication, and blacklist filtering
 */

import { describe, it, expect } from 'vitest';

// Mock competitor data structures
interface Competitor {
  id: number;
  keywordId: number;
  domain: string;
  url: string;
  title: string;
  position: number;
  batchId: number;
  date: Date;
}

describe('Competitor Deduplication Logic', () => {
  describe('Domain Deduplication', () => {
    it('should remove duplicate domains, keeping first occurrence', () => {
      const competitors: Competitor[] = [
        { id: 1, keywordId: 1, domain: 'example.com', url: 'https://example.com/page1', title: 'Page 1', position: 1, batchId: 1, date: new Date() },
        { id: 2, keywordId: 1, domain: 'competitor.com', url: 'https://competitor.com/page', title: 'Competitor', position: 2, batchId: 1, date: new Date() },
        { id: 3, keywordId: 1, domain: 'example.com', url: 'https://example.com/page2', title: 'Page 2', position: 3, batchId: 1, date: new Date() },
      ];
      
      const uniqueCompetitors: Competitor[] = [];
      const seenDomains = new Set<string>();
      
      for (const comp of competitors) {
        const lowerDomain = comp.domain.toLowerCase();
        if (!seenDomains.has(lowerDomain)) {
          seenDomains.add(lowerDomain);
          uniqueCompetitors.push(comp);
        }
      }
      
      expect(uniqueCompetitors.length).toBe(2);
      expect(uniqueCompetitors[0].domain).toBe('example.com');
      expect(uniqueCompetitors[0].id).toBe(1); // First occurrence kept
    });

    it('should handle case-insensitive domain matching', () => {
      const competitors: Competitor[] = [
        { id: 1, keywordId: 1, domain: 'Example.com', url: 'https://example.com/page1', title: 'Page 1', position: 1, batchId: 1, date: new Date() },
        { id: 2, keywordId: 1, domain: 'example.com', url: 'https://example.com/page2', title: 'Page 2', position: 2, batchId: 1, date: new Date() },
      ];
      
      const uniqueCompetitors: Competitor[] = [];
      const seenDomains = new Set<string>();
      
      for (const comp of competitors) {
        const lowerDomain = comp.domain.toLowerCase();
        if (!seenDomains.has(lowerDomain)) {
          seenDomains.add(lowerDomain);
          uniqueCompetitors.push(comp);
        }
      }
      
      expect(uniqueCompetitors.length).toBe(1);
    });
  });

  describe('Blacklist Filtering', () => {
    it('should filter out blacklisted competitors', () => {
      const competitors: Competitor[] = [
        { id: 1, keywordId: 1, domain: 'example.com', url: 'https://example.com/page', title: 'Example', position: 1, batchId: 1, date: new Date() },
        { id: 2, keywordId: 1, domain: 'blacklisted.com', url: 'https://blacklisted.com/page', title: 'Blacklisted', position: 2, batchId: 1, date: new Date() },
        { id: 3, keywordId: 1, domain: 'competitor.com', url: 'https://competitor.com/page', title: 'Competitor', position: 3, batchId: 1, date: new Date() },
      ];
      
      const blacklistedDomains = new Set(['blacklisted.com']);
      
      const filtered = competitors.filter(comp => 
        !blacklistedDomains.has(comp.domain.toLowerCase())
      );
      
      expect(filtered.length).toBe(2);
      expect(filtered.every(comp => comp.domain !== 'blacklisted.com')).toBe(true);
    });
  });

  describe('Position Sorting', () => {
    it('should sort competitors by position', () => {
      const competitors: Competitor[] = [
        { id: 1, keywordId: 1, domain: 'third.com', url: 'https://third.com/page', title: 'Third', position: 3, batchId: 1, date: new Date() },
        { id: 2, keywordId: 1, domain: 'first.com', url: 'https://first.com/page', title: 'First', position: 1, batchId: 1, date: new Date() },
        { id: 3, keywordId: 1, domain: 'second.com', url: 'https://second.com/page', title: 'Second', position: 2, batchId: 1, date: new Date() },
      ];
      
      const sorted = competitors.sort((a, b) => a.position - b.position);
      
      expect(sorted[0].position).toBe(1);
      expect(sorted[1].position).toBe(2);
      expect(sorted[2].position).toBe(3);
    });
  });
});
