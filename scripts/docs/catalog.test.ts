import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { auditCatalog, linksIn } from './catalog.js';

const fixtures: string[] = [];
afterEach(() => { for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(): string {
  const root = mkdtempSync(resolve(tmpdir(), 'docs-catalog-'));
  fixtures.push(root);
  put(root, 'docs/README.md', '[入口](README.md)\n[使い方](guide.md)\n[図](images/図.png)\n[機能](../apps/README)\n');
  put(root, 'docs/guide.md', '# 使い方\n\n[入口](README.md)\n![図](images/%E5%9B%B3.png)\n');
  put(root, 'docs/images/図.png', 'image fixture');
  put(root, 'apps/README', '機能の説明');
  return root;
}
function put(root: string, path: string, text: string): void {
  const file = resolve(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

describe('文書の入口と参照の見張り', () => {
  test('実際のリポジトリで未掲載・重複・行き先の欠落がない', () => {
    expect(auditCatalog(resolve(import.meta.dirname, '../..'))).toEqual([]);
  });
  test('画像・拡張子のないREADMEも含めて全部たどれる', () => {
    expect(auditCatalog(fixture())).toEqual([]);
  });
  test.each(['docs/new.md', 'docs/new.mdx', 'docs/new.rst', 'docs/new.adoc', 'docs/new.txt', 'docs/map.json', 'docs/chart.tsv', 'docs/new.png', 'apps/TODO'])(
    '入口へ足さずに %s を置いた故障を検出する', (path) => {
      const root = fixture();
      put(root, path, 'new document');
      expect(auditCatalog(root)).toContainEqual(expect.objectContaining({ target: path, problem: '入口への掲載は1回必要' }));
    },
  );
  test('同じ文書の重複掲載を検出する', () => {
    const root = fixture();
    put(root, 'docs/README.md', '[入口](README.md)\n[使い方](guide.md)\n[別の見出し](./guide.md#heading)');
    expect(auditCatalog(root)).toContainEqual(expect.objectContaining({ target: 'docs/guide.md' }));
  });
  test('入口のリンク先が消えた故障と復元を確認する', () => {
    const root = fixture();
    unlinkSync(resolve(root, 'docs/images/図.png'));
    expect(auditCatalog(root)).toContainEqual(expect.objectContaining({ source: 'docs/README.md:3', problem: 'ローカルリンクの行き先がない' }));
    put(root, 'docs/images/図.png', 'restored image');
    expect(auditCatalog(root)).toEqual([]);
  });
  test('本文から外した文書へ向く相対リンクを検出する', () => {
    const root = fixture();
    put(root, 'docs/guide.md', '[過去の記録](removed.md)');
    expect(auditCatalog(root)).toEqual([expect.objectContaining({ source: 'docs/guide.md:1', target: 'removed.md' })]);
  });
  test.each(['/docs/removed.md', '/docs%2Fremoved.md'])('外した文書へのルート相対リンク %s を検出する', (target) => {
    const root = fixture();
    put(root, 'docs/guide.md', `[過去の記録](${target})`);
    expect(auditCatalog(root)).toEqual([expect.objectContaining({ source: 'docs/guide.md:1', target })]);
  });
  test('入口のルート相対リンクも同じ文書として数える', () => {
    const root = fixture();
    put(root, 'docs/README.md', '[入口](/docs/README.md)\n[使い方](/docs/guide.md)\n[図](/docs/images/図.png)\n[機能](../apps/README)');
    expect(auditCatalog(root)).toEqual([]);
  });
  test('アプリの画面URLや外部URLを文書ファイルと取り違えない', () => {
    const root = fixture();
    put(root, 'docs/guide.md', '[友だち](/friends?view=list)\n[外部](https://example.invalid/docs/missing.md)\n[外部2](//example.invalid/docs/missing.md)');
    expect(auditCatalog(root)).toEqual([]);
  });
  test('リポジトリの外の実在ファイルへ抜けるリンクを検出する', () => {
    const root = fixture();
    put(root, 'docs/guide.md', '[外部](../../outside.md)');
    expect(auditCatalog(root)).toHaveLength(1);
  });
  test('入口をフォルダだけに置き換える故障を検出する', () => {
    const root = fixture();
    put(root, 'docs/README.md', '[文書](./)');
    expect(auditCatalog(root)).toContainEqual(expect.objectContaining({ problem: '入口は文書ファイルへ直接つなぐ' }));
  });
  test('入口そのものがない場合も失敗する', () => {
    const root = fixture();
    unlinkSync(resolve(root, 'docs/README.md'));
    expect(auditCatalog(root)).toEqual([expect.objectContaining({ problem: '文書の入口がない' })]);
  });
  test('参照形式・HTMLの相対リンクも検査する', () => {
    const root = fixture();
    put(root, 'docs/guide.md', '[古い資料][past]\n[past]: gone.md\n<img src="gone.png">\n[未定義][missing]');
    expect(auditCatalog(root).map((finding) => finding.target)).toEqual(['gone.md', 'gone.png', 'reference:missing']);
  });
  test('コード例を参照と取り違えず、空白・括弧を含むリンクを読む', () => {
    expect(linksIn('```md\n[例](missing.md)\n```\n`[例](missing.md)`\n[図](<a (1).png>)\n[説明](a(1).md "題")\n[参照][a]\n[a]: guide.md')).toEqual([
      { target: 'a (1).png', line: 5 }, { target: 'a(1).md', line: 6 }, { target: 'guide.md', line: 7 },
    ]);
  });
});
