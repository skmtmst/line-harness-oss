import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
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

const mit = `Copyright (c) Fixture
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

function collectFixture(files: Record<string, string>, license = 'MIT') {
  const root = mkdtempSync(join(tmpdir(), 'notices-sections-')); roots.push(root);
  const path = join(root, 'node_modules', 'fixture'); mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', license }));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(path, name), content);
  return collectNoticePackages({ [license]: [{ paths: [path] }] }, root);
}

test.each(['## License', 'License (MIT)\n-------------'])('collects an actual README grant under %s with exact source provenance', title => {
  const source = `# Example\n\n${title}\n${mit}\n\n## Usage\nusage instructions`;
  const packages = collectFixture({ 'README.md': source });
  expect(packages[0]?.texts).toHaveLength(1);
  const notice = packages[0]!.texts[0]!;
  expect(notice.text).toBe(`${title}\n${mit}\n`);
  expect(notice.source).toEqual({ path: 'README.md', startLine: 3,
    endLine: title.split('\n').length + mit.split('\n').length + 3,
    sha256: createHash('sha256').update(source).digest('hex') });
  expect(renderNotices(packages, 'fixture', 'hash').bom.components[0]?.properties[0]?.value).toBe('included-in-notices');
});

test.each(['## License\nMIT', '## License\n[MIT](https://example.invalid/license)',
  '## Licensing\n| Library | LGPL-3.0-or-later |', '## License\nAgree to the external service terms.',
  `## Example\n${mit}`, '## License\nPermission is hereby granted but this is only a fragment.'])('leaves a name, link or incomplete grant unresolved: %s', source => {
  const packages = collectFixture({ 'README.md': source });
  expect(packages[0]?.texts).toEqual([]);
  expect(renderNotices(packages, 'fixture', 'hash').bom.components[0]?.properties[0]?.value).toBe('review-required');
});

test('includes complete leading source grants and preserves the whole original file hash', () => {
  const source = `/*\n${mit}\n*/\nexport const example = true;\n`;
  const packages = collectFixture({ 'index.js': source });
  expect(packages[0]?.texts[0]?.text).toBe(`/*\n${mit}\n*/`);
  expect(packages[0]?.texts[0]?.source.sha256).toBe(createHash('sha256').update(source).digest('hex'));
  expect(packages[0]?.texts[0]?.coversDeclaredLicense).toBe(false);
  expect(renderNotices(packages, 'fixture', 'hash').bom.components[0]?.properties[0]?.value).toBe('review-required');
  expect(collectFixture({ 'index.js': `export const example = true;\n/*\n${mit}\n*/` })[0]?.texts).toEqual([]);
});

test('a borrowed source grant is included without resolving a different package declaration', () => {
  const packages = collectFixture({ 'borrowed.js': `/*\n${mit}\n*/` }, 'Apache-2.0');
  expect(packages[0]?.texts).toHaveLength(1);
  expect(packages[0]?.texts[0]?.coversDeclaredLicense).toBe(false);
  const result = renderNotices(packages, 'fixture', 'hash');
  expect(result.text).toContain(mit);
  expect(result.bom.components[0]?.properties[0]?.value).toBe('review-required');
});

test('keeps BSD source notices and distinguishes an additional endorsement condition', () => {
  const grant = `Copyright (c) Fixture
Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;
  const header = (text: string) => text.split('\n').map(line => `// ${line}`).join('\n') + '\n';
  expect(collectFixture({ 'index.js': header(grant) }, 'BSD-2-Clause')[0]?.texts[0]?.coversDeclaredLicense).toBe(false);
  const additional = grant.replace('THIS SOFTWARE', 'Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.\nTHIS SOFTWARE');
  const packages = collectFixture({ 'borrowed.js': header(additional) });
  expect(packages[0]?.texts).toHaveLength(1);
  expect(packages[0]?.texts[0]?.coversDeclaredLicense).toBe(false);
  expect(renderNotices(packages, 'fixture', 'hash').bom.components[0]?.properties[0]?.value).toBe('review-required');
});

test('preserves an explicit public-domain permission without replacing it with an invented license', () => {
  const declaration = 'This library is released as "public domain". You can copy, modify, re-release and re-license, or incorporate into any other project without restriction of any kind.';
  const packages = collectFixture({ 'README.md': `## License\n\n${declaration}\n` }, 'Public domain');
  expect(packages[0]?.texts[0]?.text).toBe(`## License\n\n${declaration}\n`);
  expect(packages[0]?.texts[0]?.coversDeclaredLicense).toBe(true);
});
