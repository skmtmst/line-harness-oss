import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Security floors from the advisories recorded in SECURITY-CHECKLIST.md.
// Scan every resolved lock entry, so an old transitive copy also fails the check.
function assertPatched(lock: string) {
  for (const [name, minimum] of [['fast-uri', [3, 1, 8]], ['ip-address', [10, 7, 1]], ['@line/liff', [2, 31, 1]], ['vitest', [4, 1, 11]], ['@hono/node-server', [1, 19, 15]], ['qs', [6, 16, 0]], ['body-parser', [2, 3, 0]], ['@babel/core', [7, 29, 6]]] as const) {
    const versions = [...lock.matchAll(new RegExp(`^  [\'"]?${name}@(\\d+)\\.(\\d+)\\.(\\d+)([^:\\r\\n]*)?:`, 'gm'))];
    expect(versions.length, `${name} must be found`).toBeGreaterThan(0);
    for (const match of versions) {
      const version = match.slice(1, 4).map(Number);
      const firstDifference = version.findIndex((part, i) => part !== minimum[i]);
      expect(firstDifference < 0 || version[firstDifference] > minimum[firstDifference],
        `${name}@${version.join('.')} is below its security floor`).toBe(true);
    }
  }
  // Vitest 4 no longer needs tinypool. Reject any vulnerable copy introduced by
  // another development tool, including a second transitive version.
  for (const match of lock.matchAll(/^  ['"]?tinypool@(\d+)\.(\d+)\.(\d+)[^:\r\n]*:/gm)) {
    const [major, minor, patch] = match.slice(1, 4).map(Number);
    expect(major > 2 || (major === 2 && (minor > 1 || (minor === 1 && patch >= 2))),
      'tinypool must include both critical security fixes').toBe(true);
  }
}

describe('patched dependency floors', () => {
  it('the real lockfile contains no vulnerable copies of the patched packages', () => {
    assertPatched(readFileSync(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8'));
  });
  it.each(['fast-uri@3.1.7', 'ip-address@10.7.0', "'@line/liff@2.31.0'", 'vitest@3.2.7', 'tinypool@1.1.1', 'tinypool@2.1.1', "'@hono/node-server@1.19.14'", 'qs@6.15.3', 'body-parser@2.2.2', "'@babel/core@7.29.0'"])('detects deliberately reintroduced vulnerable entry %s', entry => {
    const lock = `  '@line/liff@2.31.1':\n  fast-uri@3.1.8:\n  ip-address@10.7.1:\n  vitest@4.1.11:\n  '@hono/node-server@1.19.17':\n  qs@6.16.1:\n  body-parser@2.3.0:\n  '@babel/core@7.29.7':\n  ${entry}:\n`;
    expect(() => assertPatched(lock)).toThrow();
  });
});
