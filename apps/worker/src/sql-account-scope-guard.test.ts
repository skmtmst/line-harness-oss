import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { expect, test } from 'vitest';

// 検出の条件そのもの。読み取る場所・受け手の名前・?の形は変えない。
const SCOPED_NAME = /(?:^|\.)(?:allowedAccountIds|allowedLineAccountIds|accountIds|lineAccountIds|visibleAccountIds|visibleActiveIds|accountTagIds)$/;
const SCOPED_IDS = /(?:^|\.)(?:scope|visibleScope)\.ids$/;

// 店舗範囲は件数に上限がない。権限のSQL条件に個別の変数を展開しない。
// 全体を1件で見る監査なので、対象が増えるほど時間が伸びる。
// vitest の既定5秒だと全件並行走行の負荷で足りず、CIだけが落ちていた。
// 検出条件は変えず、制限時間を明示して余裕を持たせる。
test('店舗範囲のSQLはIDごとの変数を展開しない', () => {
  const roots = [resolve('../../packages/db/src'), resolve('src/routes'), resolve('src/services')];
  const violations: string[] = [];
  for (const root of roots) {
    for (const name of readdirSync(root)) {
      if (!name.endsWith('.ts') || name.includes('.test.')) continue;
      const path = resolve(root, name);
      // 親ポインタ(setParentNodes)は作らない。下で使う getText / getStart には
      // source を渡しており、親をたどる処理が無いため結果は変わらない。
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, false);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === 'map') {
          const receiver = node.expression.expression.getText(source);
          const scoped = SCOPED_NAME.test(receiver)
            || SCOPED_IDS.test(receiver)
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
}, 120_000);
