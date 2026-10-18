import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import ts from 'typescript';

/**
 * Read a feature's implementation after extraction without following unrelated
 * dependencies. Only actual same-family static imports/re-exports count. Other
 * independently audited entries remain separate; unimported files stay unknown.
 */
export function implementationFiles(entry: string, auditedEntries: ReadonlySet<string> = new Set()): string[] {
  const root = resolve(entry);
  const folder = dirname(root);
  const family = basename(root, extname(root));
  const seen = new Set<string>();
  function visit(file: string): void {
    if (seen.has(file)) return;
    seen.add(file);
    const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const node of ast.statements) {
      if ((!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node))
        || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)
        || !node.moduleSpecifier.text.startsWith('.')) continue;
      let next = resolve(dirname(file), node.moduleSpecifier.text.replace(/\.js$/, '.ts'));
      if (!extname(next)) next += '.ts';
      if (dirname(next) !== folder || !basename(next).startsWith(`${family}-`)
        || (next !== root && auditedEntries.has(next)) || !existsSync(next)) continue;
      visit(next);
    }
  }
  visit(root);
  return [...seen];
}

export function readImplementationSource(entry: string, auditedEntries?: ReadonlySet<string>): string {
  return implementationFiles(entry, auditedEntries).map(file => readFileSync(file, 'utf8')).join('\n');
}
