import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Security floors from the advisories recorded in SECURITY-CHECKLIST.md.
// Scan every resolved lock entry, so an old transitive copy also fails the check.
function assertPatched(lock: string) {
  for (const [name, minimum] of [['fast-uri', [3, 1, 8]], ['ip-address', [10, 7, 1]], ['@line/liff', [2, 31, 1]]] as const) {
    const versions = [...lock.matchAll(new RegExp(`^  [\'"]?${name}@(\\d+)\\.(\\d+)\\.(\\d+)([^:\\r\\n]*)?:`, 'gm'))];
    expect(versions.length, `${name} must be found`).toBeGreaterThan(0);
    for (const match of versions) {
      const version = match.slice(1, 4).map(Number);
      const firstDifference = version.findIndex((part, i) => part !== minimum[i]);
      expect(firstDifference < 0 || version[firstDifference] > minimum[firstDifference],
        `${name}@${version.join('.')} is below its security floor`).toBe(true);
    }
  }
}

describe('S26 patched dependency floors', () => {
  it('the real lockfile contains no vulnerable copies of the three patched packages', () => {
    assertPatched(readFileSync(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8'));
  });
  it.each(['fast-uri@3.1.7', 'ip-address@10.7.0', "'@line/liff@2.31.0'"])('detects deliberately reintroduced vulnerable entry %s', entry => {
    const lock = `  '@line/liff@2.31.1':\n  fast-uri@3.1.8:\n  ip-address@10.7.1:\n  ${entry}:\n`;
    expect(() => assertPatched(lock)).toThrow();
  });
});
