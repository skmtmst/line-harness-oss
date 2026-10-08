import ts from 'typescript';

export type Registration = {
  method: string; path: string; router: string; position: number; guarded: boolean;
  mountedRouter?: string;
};
const GUARDS = new Set(['requireRole', 'requirePermission', 'requirePlatformAdminWrite', 'authMiddleware']);

/** Import names alone never protect a route: only middleware arguments count. */
export function registrations(source: string): Registration[] {
  const file = ts.createSourceFile('routes.ts', source, ts.ScriptTarget.Latest, true);
  const aliases = new Map<string, ts.Expression | string>();
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node): void {
    if (ts.isImportSpecifier(node)) aliases.set(node.name.text, (node.propertyName ?? node.name).text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) aliases.set(node.name.text, node.initializer);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  function guard(node: ts.Node, seen = new Set<string>()): boolean {
    if (ts.isCallExpression(node)) return guard(node.expression, seen);
    if (!ts.isIdentifier(node) || seen.has(node.text)) return false;
    if (GUARDS.has(node.text)) return true;
    seen.add(node.text);
    const alias = aliases.get(node.text);
    return typeof alias === 'string' ? GUARDS.has(alias) : alias ? guard(alias, seen) : false;
  }
  return calls.flatMap((call) => {
    const expression = call.expression as ts.PropertyAccessExpression;
    const method = expression.name.text;
    if (!['use', 'route', 'post', 'put', 'patch', 'delete', 'all'].includes(method)) return [];
    const path = call.arguments[0];
    if (!path || !(ts.isStringLiteral(path) || ts.isNoSubstitutionTemplateLiteral(path))) return [];
    return [{ method: method.toUpperCase(), path: path.text, router: expression.expression.getText(file),
      position: call.getStart(file), guarded: call.arguments.slice(1).some((argument) => guard(argument)),
      ...(method === 'route' ? { mountedRouter: call.arguments[1]?.getText(file) } : {}),
    }];
  });
}

export function matchesMiddleware(pattern: string, path: string): boolean {
  if (pattern === '*') return true;
  const escaped = pattern.split('/').map((part) => part === '*' ? '.*'
    : part.startsWith(':') ? '[^/]+'
      : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/');
  return new RegExp(`^${escaped}$`).test(path);
}

export function hasPriorGuard(route: Registration, middleware: Registration[]): boolean {
  return middleware.some((guard) => guard.method === 'USE' && guard.guarded
    && guard.router === route.router && guard.position < route.position
    && matchesMiddleware(guard.path, route.path));
}

export function exportedRouters(source: string): Map<string, string> {
  const file = ts.createSourceFile('routes.ts', source, ts.ScriptTarget.Latest, true);
  const result = new Map<string, string>();
  for (const statement of file.statements) {
    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      result.set('default', statement.expression.text);
    } else if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const entry of statement.exportClause.elements) result.set(entry.name.text, (entry.propertyName ?? entry.name).text);
    } else if (ts.isVariableStatement(statement)
      && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) result.set(declaration.name.text, declaration.name.text);
      }
    }
  }
  return result;
}

export function importedRouters(source: string): Map<string, { module: string; exported: string }> {
  const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
  const result = new Map<string, { module: string; exported: string }>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    const module = statement.moduleSpecifier.text;
    if (clause?.name) result.set(clause.name.text, { module, exported: 'default' });
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const entry of clause.namedBindings.elements) result.set(entry.name.text, { module, exported: (entry.propertyName ?? entry.name).text });
    }
  }
  return result;
}
