/**
 * Issue #526 — Farm Methodology completeness helper.
 *
 * Locks the pure scoring of the six-field Farm Methodology Object
 * (`FarmMethodology` in lib/einstein/settings-schema.ts). The helper drives a
 * dismissible nudge banner that asks under-configured farms to fill in their
 * Methodology so Farm Einstein has richer context. This test pins:
 *   - an empty / undefined methodology scores 0, with all six fields missing,
 *   - whitespace-only fields count as not-filled,
 *   - a half-filled methodology lands exactly on ratio 0.5,
 *   - a fully-filled methodology scores 1.0 with an empty `missing` list,
 *   - the `missing` list is the field keys NOT filled (order = field order),
 *   - LOW_COMPLETENESS_THRESHOLD is the documented banner cutoff.
 */

import { describe, it, expect } from 'vitest';
import type { FarmMethodology } from '@/lib/einstein/settings-schema';
import {
  methodologyCompleteness,
  LOW_COMPLETENESS_THRESHOLD,
} from '@/lib/einstein/methodology-completeness';

describe('methodologyCompleteness', () => {
  it('treats undefined methodology as 0 filled, all six missing', () => {
    const result = methodologyCompleteness(undefined);
    expect(result.filled).toBe(0);
    expect(result.total).toBe(6);
    expect(result.ratio).toBe(0);
    expect(result.missing).toEqual([
      'tier',
      'speciesMix',
      'breedingCalendar',
      'rotationPolicy',
      'lsuThresholds',
      'farmerNotes',
    ]);
  });

  it('treats an empty object the same as undefined', () => {
    const result = methodologyCompleteness({});
    expect(result.filled).toBe(0);
    expect(result.ratio).toBe(0);
    expect(result.missing).toHaveLength(6);
  });

  it('counts whitespace-only fields as not filled', () => {
    const methodology: FarmMethodology = {
      tier: '   ',
      speciesMix: '\t\n ',
      breedingCalendar: '',
    };
    const result = methodologyCompleteness(methodology);
    expect(result.filled).toBe(0);
    expect(result.ratio).toBe(0);
    expect(result.missing).toContain('tier');
    expect(result.missing).toContain('speciesMix');
    expect(result.missing).toContain('breedingCalendar');
  });

  it('scores a half-filled methodology at exactly 0.5', () => {
    const methodology: FarmMethodology = {
      tier: 'commercial cow-calf',
      speciesMix: 'Bonsmara + Dorper',
      breedingCalendar: 'Spring calving, Aug–Oct',
    };
    const result = methodologyCompleteness(methodology);
    expect(result.filled).toBe(3);
    expect(result.ratio).toBe(0.5);
    expect(result.missing).toEqual([
      'rotationPolicy',
      'lsuThresholds',
      'farmerNotes',
    ]);
  });

  it('trims surrounding whitespace when deciding "filled"', () => {
    const methodology: FarmMethodology = {
      tier: '  stud operation  ',
    };
    const result = methodologyCompleteness(methodology);
    expect(result.filled).toBe(1);
    expect(result.missing).not.toContain('tier');
  });

  it('scores a fully-filled methodology at 1.0 with no missing fields', () => {
    const methodology: FarmMethodology = {
      tier: 'commercial mixed cow-calf',
      speciesMix: 'cattle + sheep',
      breedingCalendar: 'Aug–Oct calving',
      rotationPolicy: '6-camp rotation, 21-day rest',
      lsuThresholds: '0.18 LSU/ha winter',
      farmerNotes: 'avoid moving cattle on rainy days',
    };
    const result = methodologyCompleteness(methodology);
    expect(result.filled).toBe(6);
    expect(result.ratio).toBe(1);
    expect(result.missing).toEqual([]);
  });

  it('exposes a sane low-completeness threshold for the banner', () => {
    expect(LOW_COMPLETENESS_THRESHOLD).toBeGreaterThan(0);
    expect(LOW_COMPLETENESS_THRESHOLD).toBeLessThanOrEqual(1);
    // 3-of-6 filled sits on the boundary and must NOT be considered "low"
    // (banner fires only on ratio strictly below the threshold).
    expect(0.5 < LOW_COMPLETENESS_THRESHOLD).toBe(false);
  });
});
