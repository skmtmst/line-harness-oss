import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { implementationFiles, readImplementationSource } from './implementation-source.js';
let folder: string;
beforeEach(() => { folder = mkdtempSync(join(tmpdir(), 'implementation-source-')); });
afterEach(() => rmSync(folder, { recursive: true }));
it('follows only imported implementation modules and keeps unknown or unrelated senders outside', () => {
  writeFileSync(join(folder, 'feature.ts'), "import './feature-unused.js';\nimport { handler } from './feature-send.js';\nimport { helper } from './other.js';");
  writeFileSync(join(folder, 'feature-send.ts'), "export { handler } from './feature-validation.js';");
  writeFileSync(join(folder, 'feature-validation.ts'), 'export const handler = 1;');
  writeFileSync(join(folder, 'feature-rogue.ts'), 'unknown-sender');
  writeFileSync(join(folder, 'other.ts'), 'unrelated-resolver');
  // Explicit same-family side-effect imports are included too.
  writeFileSync(join(folder, 'feature-unused.ts'), 'unrelated-side-effect');
  expect(implementationFiles(join(folder, 'feature.ts'))).toEqual([
    join(folder, 'feature.ts'), join(folder, 'feature-unused.ts'), join(folder, 'feature-send.ts'), join(folder, 'feature-validation.ts'),
  ]);
  expect(readImplementationSource(join(folder, 'feature.ts'))).not.toContain('unknown-sender');
  expect(readImplementationSource(join(folder, 'feature.ts'))).not.toContain('unrelated-resolver');
});
it('keeps an independently audited entry separate even if it shares the family name', () => {
  writeFileSync(join(folder, 'feature.ts'), "export { handler } from './feature-send.js';");
  writeFileSync(join(folder, 'feature-send.ts'), 'export const handler = 1;');
  expect(implementationFiles(join(folder, 'feature.ts'), new Set([join(folder, 'feature-send.ts')]))).toEqual([join(folder, 'feature.ts')]);
});
it('does not recurse forever through re-exports', () => {
  writeFileSync(join(folder, 'feature.ts'), "export * from './feature-send.js';");
  writeFileSync(join(folder, 'feature-send.ts'), "export * from './feature-send.js';");
  expect(implementationFiles(join(folder, 'feature.ts'))).toHaveLength(2);
});
