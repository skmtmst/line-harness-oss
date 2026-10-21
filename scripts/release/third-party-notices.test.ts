import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { collectNoticePackages, renderNotices } from './third-party-notices.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
test('keeps individual installed versions, exact notices, and no local paths in the export', () => {
  const root = mkdtempSync(join(tmpdir(), 'notices-')); roots.push(root);
  const paths = ['first', 'second', 'missing'].map((name, i) => {
    const path = join(root, 'node_modules', name); mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'package.json'), JSON.stringify({ name: 'fixture', version: `${i}.0.0`, license: i === 1 ? 'SEE LICENSE IN README.md' : 'MIT' }));
    if (i < 2) writeFileSync(join(path, i === 1 ? 'README.md' : 'LICENSE'), `Copyright fixture ${i}\nExact permission.`);
    return path;
  });
  const packages = collectNoticePackages({ MIT: [{ paths }] }, root);
  const result = renderNotices(packages, '0.24.0', 'fixture-lock-hash');
  expect(result.bom.components.map(pkg => pkg.version)).toEqual(['0.0.0', '1.0.0', '2.0.0']);
  expect(result.text).toContain('Copyright fixture 1\nExact permission.');
  expect(result.text).toContain('No license text found');
  expect(JSON.stringify(result)).not.toContain(root);
  expect(result.bom.components[2]?.properties[0]?.value).toBe('review-required');
});
