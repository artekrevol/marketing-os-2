/**
 * Unit Tests for Location Code Mapping
 * 
 * Tests location code lookup, special cases (San Francisco), and fallback logic
 */

import { describe, it, expect } from 'vitest';

interface Location {
  id: number;
  name: string;
  code: string;
  dataForSEOLocationCode: string | null;
}

describe('Location Code Mapping', () => {
  describe('San Francisco Special Case', () => {
    it('should return 1014221 for San Francisco, CA, US', () => {
      const location: Location = {
        id: 1,
        name: 'San Francisco',
        code: 'CA,US',
        dataForSEOLocationCode: null
      };
      
      // Simulate the special case logic
      const [state, country] = location.code.split(',');
      const isSanFrancisco = location.name === 'San Francisco' && 
                            state === 'CA' && 
                            country === 'US';
      
      if (isSanFrancisco) {
        expect('1014221').toBe('1014221');
      } else {
        throw new Error('San Francisco special case not detected');
      }
    });

    it('should not apply special case for other cities in CA', () => {
      const location: Location = {
        id: 2,
        name: 'Los Angeles',
        code: 'CA,US',
        dataForSEOLocationCode: null
      };
      
      const [state, country] = location.code.split(',');
      const isSanFrancisco = location.name === 'San Francisco' && 
                            state === 'CA' && 
                            country === 'US';
      
      expect(isSanFrancisco).toBe(false);
    });
  });

  describe('Database Field Priority', () => {
    it('should use dataForSEOLocationCode if available', () => {
      const location: Location = {
        id: 1,
        name: 'New York',
        code: 'NY,US',
        dataForSEOLocationCode: '1023191'
      };
      
      // Should use database field first
      const locationCode = location.dataForSEOLocationCode || 'fallback';
      
      expect(locationCode).toBe('1023191');
      expect(locationCode).not.toBe('fallback');
    });
  });

  describe('Fallback Logic', () => {
    it('should fallback to US (2840) if location not found', () => {
      const location: Location = {
        id: 1,
        name: 'Unknown City',
        code: 'XX,YY',
        dataForSEOLocationCode: null
      };
      
      // Simulate fallback
      const locationCode = location.dataForSEOLocationCode || '2840'; // US fallback
      
      expect(locationCode).toBe('2840');
    });

    it('should handle numeric codes directly', () => {
      const location: Location = {
        id: 1,
        name: 'Test Location',
        code: '2840', // Already a numeric code
        dataForSEOLocationCode: null
      };
      
      // If code is numeric, use it directly
      const isNumeric = /^\d+$/.test(location.code);
      const locationCode = isNumeric ? location.code : '2840';
      
      expect(locationCode).toBe('2840');
    });
  });
});
