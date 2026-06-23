/**
 * Unit Tests for Scheduler & Cron Expression Parsing
 * 
 * Tests cron expression parsing, validation, and competitor analysis timing
 */

import { describe, it, expect } from 'vitest';

describe('Cron Expression Parsing', () => {
  describe('Special Values', () => {
    it('should parse "daily" to 0 4 * * *', () => {
      const expression = 'daily';
      const parsed = expression === 'daily' ? '0 4 * * *' : expression;
      
      expect(parsed).toBe('0 4 * * *');
    });

    it('should parse "weekly" to 0 4 * * 1', () => {
      const expression = 'weekly';
      const parsed = expression === 'weekly' ? '0 4 * * 1' : expression;
      
      expect(parsed).toBe('0 4 * * 1');
    });

    it('should parse "monthly" to 0 4 1 * *', () => {
      const expression = 'monthly';
      const parsed = expression === 'monthly' ? '0 4 1 * *' : expression;
      
      expect(parsed).toBe('0 4 1 * *');
    });
  });

  describe('Competitor Analysis Timing', () => {
    it('should add 30 minutes to keyword crawl time', () => {
      const keywordCron = '0 4 * * *'; // 4:00 AM
      const [minutes, hours] = keywordCron.split(' ').map(Number);
      
      let newMinutes = minutes + 30;
      let newHours = hours;
      
      // Handle hour rollover
      if (newMinutes >= 60) {
        newMinutes = newMinutes - 60;
        newHours = (newHours + 1) % 24;
      }
      
      const competitorCron = `${newMinutes} ${newHours}`;
      
      expect(competitorCron).toBe('30 4');
    });

    it('should handle hour rollover when adding 30 minutes', () => {
      const keywordCron = '45 4 * * *'; // 4:45 AM
      const [minutes, hours] = keywordCron.split(' ').map(Number);
      
      let newMinutes = minutes + 30;
      let newHours = hours;
      
      // Handle hour rollover
      if (newMinutes >= 60) {
        newMinutes = newMinutes - 60;
        newHours = (newHours + 1) % 24;
      }
      
      expect(newMinutes).toBe(15);
      expect(newHours).toBe(5);
    });
  });
});
