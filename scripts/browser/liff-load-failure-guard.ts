import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** 通信失敗の枝が空配列へ黙って置き換わることを防ぐ。実行時の再試行試験と併用する。 */
export function emptyFailureBranches(source: string, file = 'component.tsx'): number[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = new Set<number>();
  function scan(branch: ts.Node) {
    let empties = false, failure = false;
    function visit(node: ts.Node) {
      if (ts.isArrayLiteralExpression(node) && node.elements.length === 0) {
        const parent = node.parent;
        if (ts.isReturnStatement(parent) || ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) && parent.body === node) || (ts.isCallExpression(parent) && /^set[A-Z]/.test(parent.expression.getText(ast)))) empties = true;
      }
      if (ts.isCallExpression(node) && /^(?:set\w*(?:Error|Failed|Failure|LookupMessage)|setError)$/i.test(node.expression.getText(ast))) {
        const arg = node.arguments[0];
        if (arg && !['null', 'false', "''", '""'].includes(arg.getText(ast))) failure = true;
      }
      ts.forEachChild(node, visit);
    }
    visit(branch);
    if (empties && !failure) lines.add(ast.getLineAndCharacterOfPosition(branch.getStart(ast)).line + 1);
  }
  function walk(node: ts.Node) {
    if (ts.isCatchClause(node)) scan(node.block);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'catch') {
      const handler = node.arguments[0];
      if (handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) scan(handler.body);
    }
    if (ts.isIfStatement(node) && ts.isPrefixUnaryExpression(node.expression) && node.expression.operator === ts.SyntaxKind.ExclamationToken && ts.isPropertyAccessExpression(node.expression.operand) && node.expression.operand.name.text === 'ok') scan(node.thenStatement);
    ts.forEachChild(node, walk);
  }
  walk(ast);
  return [...lines];
}
export function customerFailureViolations(root: string): string[] {
  const found: string[] = [];
  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(path) && !/\.(?:test|spec)\.tsx?$/.test(path)) {
        for (const line of emptyFailureBranches(readFileSync(path, 'utf8'), path)) found.push(`${relative(root, path)}:${line}`);
      }
    }
  }
  walk(join(root, 'apps/liff/src')); walk(join(root, 'apps/worker/src/client'));
  return found;
}
