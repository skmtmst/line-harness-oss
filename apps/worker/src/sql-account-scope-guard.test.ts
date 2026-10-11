import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { expect, test } from 'vitest';

// 店舗範囲は件数に上限がない。権限のSQL条件に個別の変数を展開しない。
test('店舗範囲のSQLはIDごとの変数を展開しない', () => {
  const roots = [resolve('../../packages/db/src'), resolve('src/routes'), resolve('src/services')];
  const violations: string[] = [];
  for (const root of roots) {
    for (const name of readdirSync(root)) {
      if (!name.endsWith('.ts') || name.includes('.test.')) continue;
      const path = resolve(root, name);
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === 'map') {
          const receiver = node.expression.expression.getText(source);
          const scoped = /(?:^|\.)(?:allowedAccountIds|allowedLineAccountIds|accountIds|lineAccountIds|visibleAccountIds|visibleActiveIds|accountTagIds)$/.test(receiver)
            || /(?:^|\.)(?:scope|visibleScope)\.ids$/.test(receiver)
            || (name === 'nen-tag-sync.ts' && receiver === 'assignedIds');
          const callback = node.arguments[0];
          if (scoped && callback && ts.isArrowFunction(callback)
            && ts.isStringLiteral(callback.body) && callback.body.text === '?') {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
            violations.push(`${path}:${line + 1}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  expect(violations).toEqual([]);
});
