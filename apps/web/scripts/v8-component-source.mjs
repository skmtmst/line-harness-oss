import ts from 'typescript'

/** 公開されたV8部品は、ファイルを用途名へ変えても同じ画面として扱う。 */
export function hasExportedV8Component(ast) {
  return ast.statements.some(node => ts.isFunctionDeclaration(node)
    && node.name?.text.endsWith('V8')
    && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))
}
