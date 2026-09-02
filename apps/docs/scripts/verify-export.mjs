import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const docsRoot = resolve(import.meta.dirname, '..');
const expectedPages = [
  ['top page', 'out/index.html', 'musubo マニュアル'],
  ['manual template', 'out/manual/line-account-setup/index.html', '記事テンプレート'],
  ['404 page', 'out/404.html', 'ページが見つかりません'],
];

for (const [label, relativePath, expectedText] of expectedPages) {
  const filePath = resolve(docsRoot, relativePath);
  await access(filePath);
  const html = await readFile(filePath, 'utf8');
  if (!html.includes(expectedText)) {
    throw new Error(`${label} is missing its expected content`);
  }
}

console.log(JSON.stringify({ verifiedStaticPages: expectedPages.length }));
