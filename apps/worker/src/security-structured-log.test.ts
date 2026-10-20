import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(path) && !/[.](?:test|spec)[.]/.test(path) ? [path] : [];
  });
}

it('ログへ自由な文・秘密値・顧客本文をイベント名として渡せない', () => {
  const failures: string[] = [];
  const files = ['apps/worker/src', 'apps/web/src', 'apps/liff/src', 'packages/db/src', 'packages/line-sdk/src'].flatMap(p => sources(join(root, p)));
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (!/\b(?:console|logger|createClientLogger)\b/.test(content)) continue;
    const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const loggers = new Set<string>();
    const declarations = new Map<string, ts.Expression>();
    const clientFactories = new Set<string>();
    function collect(node: ts.Node) {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier.getText(source).includes('@line-crm/shared')) {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
          if ((binding.propertyName?.text ?? binding.name.text) === 'logger') loggers.add(binding.name.text);
          if ((binding.propertyName?.text ?? binding.name.text) === 'createClientLogger') clientFactories.add(binding.name.text);
        }
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text, node.initializer);
      ts.forEachChild(node, collect);
    }
    collect(source);
    for (const [name, value] of declarations) if (ts.isCallExpression(value) && clientFactories.has(value.expression.getText(source))) loggers.add(name);
    function fixed(node: ts.Expression | undefined, seen = new Set<string>()): boolean {
      if (!node) return false;
      if (ts.isStringLiteral(node)) return /^[A-Za-z][A-Za-z0-9_.-]{0,95}$/.test(node.text);
      if (ts.isConditionalExpression(node)) return fixed(node.whenTrue, seen) && fixed(node.whenFalse, seen);
      if (ts.isIdentifier(node) && !seen.has(node.text)) {
        const next = new Set(seen); next.add(node.text);
        return fixed(declarations.get(node.text), next);
      }
      return false;
    }
    function check(node: ts.Node) {
      if (ts.isCallExpression(node) && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) && ts.isIdentifier(node.expression.expression)) {
        const owner = node.expression.expression.text;
        if (owner === 'console' || loggers.has(owner) && !fixed(node.arguments[0])) {
          failures.push(`${relative(root, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
        }
      }
      ts.forEachChild(node, check);
    }
    check(source);
  }
  expect(failures, '自由な値は固定イベント名にせず、伏せ方を保つ共通loggerを使う').toEqual([]);
}, 30_000);
