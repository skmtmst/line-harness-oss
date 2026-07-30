import { describe, expect, it } from 'vitest';
import { isConsentScrolledToBottom } from './consent-scroll.js';

describe('isConsentScrolledToBottom', () => {
  it('returns true when the whole consent is already visible', () => {
    expect(isConsentScrolledToBottom({
      scrollTop: 0,
      clientHeight: 280,
      scrollHeight: 240,
    })).toBe(true);
  });

  it('returns false before a long consent reaches the bottom', () => {
    expect(isConsentScrolledToBottom({
      scrollTop: 120,
      clientHeight: 280,
      scrollHeight: 720,
    })).toBe(false);
  });

  it('allows a small tolerance at the bottom for fractional mobile layouts', () => {
    expect(isConsentScrolledToBottom({
      scrollTop: 433,
      clientHeight: 280,
      scrollHeight: 720,
    })).toBe(true);
  });
});
