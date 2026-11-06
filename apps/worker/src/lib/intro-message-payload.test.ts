import { describe, expect, it } from 'vitest';
import { introMessagePayload } from './intro-message-payload.js';
import { buildIntroMessage } from '../services/intro-message.js';

describe('Q03 intro payload narrows unknown template contents', () => {
  it('preserves the valid text and default Flex payloads', () => {
    const text = { type: 'text', text: 'Fixture' } as const;
    expect(introMessagePayload(text)).toBe(text);
    const flex = buildIntroMessage(null, 'https://fixture.test/form');
    expect(introMessagePayload(flex)).toEqual(flex);
  });
  it.each([null, undefined, true, 42, 'string', []])('rejects non-container JSON %# before sending', contents => {
    expect(() => introMessagePayload({ type: 'flex', altText: 'Fixture', contents })).toThrow('Invalid intro message contents');
  });
});
