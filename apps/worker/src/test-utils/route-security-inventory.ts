import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import { exportedRouters, importedRouters, matchesMiddleware, registrations } from './route-guards.js';

export type SecurityRoute = {
  file: string; line: number; router: string; method: string; path: string;
  calls: string[]; evidence: string[]; position: number; guarded: boolean;
};

/** Include feature directories; splitting a router must never remove it from the security scan. */
export function routeSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? routeSourceFiles(join(directory, entry.name))
    : entry.name.endsWith('.ts') && !entry.name.includes('.test.') ? [join(directory, entry.name)] : []);
}

/** Evidence of a call is a review aid, never proof that its result is enforced. */
function inspectScopedRouteSource(file: string, source: string | ts.SourceFile, importedConstant?: (module: string, name: string) => string[]): SecurityRoute[] {
  const ast = typeof source === 'string' ? ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true) : source;
  const imports = importedRouters(ast);
  const locals = new Map<string, ts.Node>();
  const routers = new Set<string>();
  const registrationCalls: ts.CallExpression[] = [];
  const guarded = new Map(registrations(ast).map(route => [route.position, route.guarded]));
  const honoParameter = (parameter: ts.ParameterDeclaration) => ts.isIdentifier(parameter.name)
    && parameter.type && ts.isTypeReferenceNode(parameter.type) && parameter.type.typeName.getText(ast) === 'Hono';
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name && ts.isSourceFile(node.parent)) {
      locals.set(node.name.text, node);
      for (const parameter of node.parameters.filter(honoParameter)) routers.add(`${node.name.text}:${parameter.name.getText(ast)}`);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const topLevel = ts.isVariableDeclarationList(node.parent) && ts.isVariableStatement(node.parent.parent)
        && ts.isSourceFile(node.parent.parent.parent);
      if (topLevel) locals.set(node.name.text, node.initializer);
      if (topLevel && ts.isNewExpression(node.initializer) && node.initializer.expression.getText(ast) === 'Hono') {
        routers.add(node.name.text);
      }
    }
    if (ts.isCallExpression(node) && (ts.isElementAccessExpression(node.expression)
      || (ts.isPropertyAccessExpression(node.expression)
      && ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all', 'use', 'on'].includes(node.expression.name.text)))
      && node.arguments[0]) {
      registrationCalls.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  function calls(node: ts.Node, seen = new Set<string>(), result = new Set<string>()): Set<string> {
    if (ts.isIdentifier(node) && locals.has(node.text) && !seen.has(node.text)
      && ts.isCallExpression(node.parent) && (node.parent.expression === node || node.parent.arguments.includes(node))) {
      seen.add(node.text);
      calls(locals.get(node.text)!, seen, result);
    }
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression)) result.add(expression.text);
      // Property names only: never copy SQL, request data or string arguments into a report.
      else if (ts.isPropertyAccessExpression(expression)) result.add(expression.name.text);
    }
    ts.forEachChild(node, child => { calls(child, seen, result); });
    return result;
  }
  function values(node: ts.Node, seen = new Set<ts.Node>()): string[] {
    if (seen.has(node)) return [];
    const nextSeen = new Set(seen).add(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) return values(node.expression, nextSeen);
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(item => values(item, nextSeen));
    if (ts.isConditionalExpression(node)) return [...new Set([...values(node.whenTrue, nextSeen), ...values(node.whenFalse, nextSeen)])];
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return values(node.left, nextSeen).flatMap(left => values(node.right, nextSeen).map(right => left + right));
    }
    if (ts.isTemplateExpression(node)) {
      let result = [node.head.text];
      for (const span of node.templateSpans) result = result.flatMap(prefix => values(span.expression, nextSeen).map(value => prefix + value + span.literal.text));
      return result;
    }
    if (ts.isIdentifier(node)) {
      let parent: ts.Node | undefined = node.parent;
      while (parent) {
        if (ts.isForOfStatement(parent) && ts.isVariableDeclarationList(parent.initializer)) {
          const binding = parent.initializer.declarations[0]?.name;
          let iterable = parent.expression;
          while (ts.isAsExpression(iterable) || ts.isParenthesizedExpression(iterable)) iterable = iterable.expression;
          if (binding && ts.isIdentifier(binding) && binding.text === node.text) return values(iterable, nextSeen);
          if (binding && ts.isArrayBindingPattern(binding) && ts.isArrayLiteralExpression(iterable)) {
            const index = binding.elements.findIndex(element => ts.isBindingElement(element) && element.name.getText(ast) === node.text);
            if (index >= 0) return iterable.elements.flatMap(row => ts.isArrayLiteralExpression(row) && row.elements[index] ? values(row.elements[index], nextSeen) : []);
          }
        }
        if (ts.isBlock(parent) || ts.isSourceFile(parent)) {
          for (const statement of parent.statements) {
            if (!ts.isVariableStatement(statement)) continue;
            const declaration = statement.declarationList.declarations.find(item => ts.isIdentifier(item.name) && item.name.text === node.text);
            if (declaration?.initializer) return values(declaration.initializer, nextSeen);
          }
        }
        parent = parent.parent;
      }
      const imported = imports.get(node.text);
      if (imported && importedConstant) return importedConstant(imported.module, imported.exported);
    }
    return [];
  }
  const routerName = (call: ts.CallExpression) => {
    const receiver = (call.expression as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression.getText(ast);
    let parent: ts.Node | undefined = call.parent;
    while (parent && !ts.isSourceFile(parent)) {
      if (ts.isFunctionDeclaration(parent) && parent.name
        && parent.parameters.some(p => honoParameter(p) && p.name.getText(ast) === receiver)) return `${parent.name.text}:${receiver}`;
      parent = parent.parent;
    }
    return receiver;
  };
  const verb = (call: ts.CallExpression) => ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : 'computed';
  const registered = registrationCalls.flatMap(call => {
    const router = routerName(call);
    if (!routers.has(router)) return [];
    const on = verb(call) === 'on';
    const methods = on ? values(call.arguments[0]) : ts.isElementAccessExpression(call.expression)
      ? values(call.expression.argumentExpression).map(value => value.toUpperCase()) : [verb(call).toUpperCase()];
    const paths = values(call.arguments[on ? 1 : 0]);
    if (!methods.length || !paths.length) throw new Error(`Unresolved route expression: ${file}:${ast.getLineAndCharacterOfPosition(call.getStart(ast)).line + 1}`);
    return methods.flatMap(method => paths.map(path => ({ call, method, path, router,
      position: call.getStart(ast), argumentOffset: on ? 2 : 1 })));
  });
  const middleware = new Map<string, typeof registered>();
  for (const registration of registered.filter(route => route.method === 'USE')) {
    const prior = middleware.get(registration.router) ?? [];
    prior.push(registration);
    middleware.set(registration.router, prior);
  }
  // The same middleware argument can guard hundreds of routes. Its complete
  // call graph is stable within this source scan, including recursive helpers.
  const argumentCalls = new Map<ts.Node, Set<string>>();
  const callsOnce = (argument: ts.Node): Set<string> => {
    const cached = argumentCalls.get(argument);
    if (cached) return cached;
    const result = calls(argument);
    argumentCalls.set(argument, result);
    return result;
  };
  return registered.map(route => {
    const inherited = (middleware.get(route.router) ?? []).filter(prior => prior.position < route.position
      && matchesMiddleware(prior.path, route.path));
    const reachable = new Set<string>();
    for (const registration of [...inherited, route]) {
      for (const argument of registration.call.arguments.slice(registration.argumentOffset)) {
        for (const name of callsOnce(argument)) reachable.add(name);
      }
    }
    const names = [...reachable].sort();
    return { file, line: ast.getLineAndCharacterOfPosition(route.position).line + 1,
      position: route.position, guarded: guarded.get(route.position) === true || inherited.some(prior => guarded.get(prior.position)),
      router: route.router, method: route.method, path: route.path, calls: names,
      evidence: names.filter(name => /canAccess|[Ss]cope|[Vv]isible|verifyCallerLineIdentity|resolveFriendFromLineToken/.test(name)) };
  });
}


/** Keep the reported router name stable while matching registrations by their lexical scope. */
export function inspectRouteSource(file: string, source: string | ts.SourceFile, importedConstant?: (module: string, name: string) => string[]): SecurityRoute[] {
  return inspectScopedRouteSource(file, source, importedConstant)
    .filter(route => route.method !== 'USE')
    .map(route => ({ ...route, router: route.router.split(':').pop()! }));
}

export function collectSecurityRoutes(srcDir: string): SecurityRoute[] {
  const sources = new Map<string, string>();
  for (const file of routeSourceFiles(join(srcDir, 'routes'))) {
    sources.set(resolve(file), readFileSync(file, 'utf8'));
  }
  sources.set(resolve(srcDir, 'index.ts'), readFileSync(join(srcDir, 'index.ts'), 'utf8'));
  // Parse only sources reached through mounted routers/factories. Handler-only
  // modules remain in the source set, so moving a registration cannot hide it.
  // Keep both caches within this scan: edits must be visible on the next call.
  function parseMetadata(file: string, source: string) {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    return {
      ast, imported: importedRouters(ast), exported: exportedRouters(ast),
      mounts: registrations(ast).filter(call => call.method === 'ROUTE'),
      invocations: ast.statements.filter(ts.isExpressionStatement)
        .map(statement => statement.expression).filter(ts.isCallExpression),
      factories: new Map(ast.statements.filter(ts.isFunctionDeclaration)
        .filter(node => node.name).map(node => [node.name!.text, node])),
    };
  }
  const metadata = new Map<string, ReturnType<typeof parseMetadata>>();
  function getMetadata(file: string) {
    const cached = metadata.get(file);
    if (cached) return cached;
    const source = sources.get(file);
    if (source === undefined) return undefined;
    const parsed = parseMetadata(file, source);
    metadata.set(file, parsed);
    return parsed;
  }
  const constantSources = new Map<string, ts.SourceFile>();
  function importedStringConstant(file: string, name: string, seen = new Set<string>()): string[] {
    const key = `${file}:${name}`;
    if (seen.has(key)) return [];
    const nextSeen = new Set(seen).add(key);
    let ast = constantSources.get(file);
    if (!ast) {
      ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      constantSources.set(file, ast);
    }
    for (const statement of ast.statements) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer && ts.isStringLiteral(declaration.initializer)) return [declaration.initializer.text];
        }
      }
      if (ts.isExportDeclaration(statement) && !statement.isTypeOnly
        && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        const binding = statement.exportClause.elements.find(entry => !entry.isTypeOnly && entry.name.text === name);
        if (!binding) continue;
        const target = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? resolve(dirname(file), statement.moduleSpecifier.text.replace(/\.js$/, '.ts')) : file;
        return importedStringConstant(target, (binding.propertyName ?? binding.name).text, nextSeen);
      }
    }
    const imported = importedRouters(ast).get(name);
    if (imported) return importedStringConstant(resolve(dirname(file), imported.module.replace(/\.js$/, '.ts')), imported.exported, nextSeen);
    return [];
  }
  const routes = new Map<string, SecurityRoute[]>();
  function getRoutes(file: string, ast: ts.SourceFile): SecurityRoute[] {
    const cached = routes.get(file);
    if (cached) return cached;
    const inspected = inspectScopedRouteSource(file, ast, (module, name) =>
      importedStringConstant(resolve(dirname(file), module.replace(/\.js$/, '.ts')), name));
    routes.set(file, inspected);
    return inspected;
  }
  function mounted(file: string, router: string, prefix = '', ancestors = new Set<string>(), inherited: SecurityRoute[] = []): SecurityRoute[] {
    const key = `${file}:${router}`;
    if (ancestors.has(key)) throw new Error('Cyclic router mount');
    const nextAncestors = new Set(ancestors).add(key);
    const meta = getMetadata(file);
    if (!meta) throw new Error(`Unresolved router source: ${file}`);
    const { ast, imported } = meta;
    const registered = getRoutes(file, ast).filter(route => route.router === router);
    const middleware = registered.filter(route => route.method === 'USE');
    const inheritAt = (position: number) => [...inherited, ...middleware.filter(route => route.position < position)
      .map(route => ({ ...route, path: prefix + (prefix && route.path === '*' ? '/*' : route.path) }))];
    const own = registered.filter(route => route.method !== 'USE')
      .map(route => ({ ...route, file: route.file.replace(resolve(srcDir), 'apps/worker/src'),
        path: prefix + (prefix && route.path === '*' ? '/*' : route.path) }));
    // A factory can register routes on a router argument without creating a Hono.
    // Follow only top-level invocations on this mounted router; unused factories
    // and similarly named parameters in other functions never become routes.
    const factoryName = router.includes(':') ? router.slice(0, router.indexOf(':')) : undefined;
    const receiver = router.split(':').pop()!;
    const body = factoryName ? meta.factories.get(factoryName)?.body : undefined;
    const invocations = body ? body.statements.filter(ts.isExpressionStatement)
      .map(statement => statement.expression).filter(ts.isCallExpression) : meta.invocations;
    for (const call of invocations) {
      if (!ts.isIdentifier(call.expression)) continue;
      const importedFactory = imported.get(call.expression.text);
      const factoryFile = importedFactory ? resolve(dirname(file), importedFactory.module.replace(/\.js$/, '.ts')) : file;
      const factoryMeta = getMetadata(factoryFile);
      if (!factoryMeta) continue;
      const factoryAst = factoryMeta.ast;
      const name = importedFactory?.exported ?? call.expression.text;
      const factory = factoryMeta.factories.get(name);
      if (!factory) continue;
      for (const [index, parameter] of factory.parameters.entries()) {
        if (!parameter.type || !ts.isTypeReferenceNode(parameter.type) || parameter.type.typeName.getText(factoryAst) !== 'Hono'
          || call.arguments[index]?.getText(ast) !== receiver) continue;
        own.push(...mounted(factoryFile, `${name}:${parameter.name.getText(factoryAst)}`, prefix, nextAncestors, inheritAt(call.getStart(ast))));
      }
    }
    for (const mount of meta.mounts.filter(call => call.router === router)) {
      const importedRouter = imported.get(mount.mountedRouter ?? '');
      const childFile = importedRouter ? resolve(dirname(file), importedRouter.module.replace(/\.js$/, '.ts')) : file;
      const childRouter = importedRouter
        ? getMetadata(childFile)?.exported.get(importedRouter.exported) : mount.mountedRouter;
      if (!childRouter) throw new Error(`Unresolved mounted router: ${file}:${mount.mountedRouter}`);
      own.push(...mounted(childFile, childRouter, prefix + (mount.path === '/' ? '' : mount.path.replace(/\/$/, '')), nextAncestors, inheritAt(mount.position)));
    }
    return own.map(route => {
      const prior = inherited.filter(middleware => matchesMiddleware(middleware.path, route.path));
      const names = [...new Set([...route.calls, ...prior.flatMap(middleware => middleware.calls)])].sort();
      return { ...route, guarded: route.guarded || prior.some(middleware => middleware.guarded), calls: names,
        evidence: names.filter(name => /canAccess|[Ss]cope|[Vv]isible|verifyCallerLineIdentity|resolveFriendFromLineToken/.test(name)) };
    });
  }
  return mounted(resolve(srcDir, 'index.ts'), 'app')
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}
