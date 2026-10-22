import { describe, expect, it } from 'vitest';
import { isSupportedNodeVersion } from '../src/steps/check-deps.js';

describe('supported Node.js security releases', () => {
  it.each(['22.23.4', '22.24.0', '24.22.1', '24.23.0', '26.12.1', '26.13.0'])('accepts %s', version => {
    expect(isSupportedNodeVersion(version)).toBe(true);
  });
  it.each(['18.20.0', '20.20.0', '22.17.0', '22.23.3', '24.22.0', '26.12.0', '25.9.0', '26.12.1-rc.1', 'invalid'])('rejects %s', version => {
    expect(isSupportedNodeVersion(version)).toBe(false);
  });
});
