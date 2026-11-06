import { describe, expect, it } from 'vitest';
import { normalizeRatingValue, trimAsciiSpaces, validateAnswer } from './form-layout.js';
import { type FormInputBlock } from './types/form-layout.js';

describe('public form input CPU bounds', () => {
  it('F14: rejects oversized and ambiguous email input before expensive parsing', () => {
    const block: FormInputBlock = { id: 'mail', kind: 'input', type: 'text', name: 'mail', label: 'Email', limit: { format: 'email' } };
    expect(validateAnswer(block, `${'a'.repeat(250)}@example.com`)).toBeTruthy();
    const start = performance.now();
    expect(validateAnswer(block, `a@${'.'.repeat(100_000)} `)).toBeTruthy();
    expect(performance.now() - start).toBeLessThan(500);
    expect(validateAnswer(block, 'a@example.com')).toBeNull();
    expect(validateAnswer(block, `${'a'.repeat(250)}@example.com`)).toBeTruthy();
  });
  it('F15: trims rating spaces in linear time and preserves invalid input', () => {
    const invalid = `1${' '.repeat(100_000)}x`;
    const start = performance.now();
    expect(normalizeRatingValue(invalid)).toBeNull();
    expect(performance.now() - start).toBeLessThan(500);
    expect(trimAsciiSpaces('   3  ')).toBe('3');
    expect(normalizeRatingValue(' 3 ')).toBe(3);
    expect(normalizeRatingValue('\t3')).toBeNull();
  });
});
