import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';

export type Finding = { rule: string; file: string; target?: string; detail: string };
export type Edge = { target: string; typeOnly: boolean; dynamic: boolean; specifier: string };
export type SourceMap = Map<string, string>;
const sourcePath = /^(?:apps\/[^/]+\/src\/|packages\/[^/]+\/src\/|scripts\/).*\.[cm]?[jt]sx?$/;
const testPath = /(?:^|\/)(?:test|tests|__tests__|fixtures|test-utils)(?:\/|$)|\.(?:test|spec)\./;
const kebab = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const pascal = /^[A-Z][A-Za-z0-9]*$/;
const nextEntry = /^apps\/web\/src\/app\/(?:.*\/)?(?:page|layout|route|loading|error|not-found|template|default)\.[jt]sx?$/;

export function repositorySources(root: string): SourceMap {
  const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  return new Map([...new Set(names.split('\0').filter(path => sourcePath.test(path)))].flatMap(path => {
    try { return [[path, readFileSync(resolve(root, path), 'utf8')]]; } catch { return []; }
  }));
}

export function moduleResolver(files: SourceMap, packages: Map<string, string> = new Map()) {
  return (from: string, specifier: string): string | undefined => {
    let path: string;
    if (specifier.startsWith('.')) path = posix.normalize(posix.join(posix.dirname(from), specifier));
    else if (specifier.startsWith('@/')) path = from.startsWith('apps/web/') ? 'apps/web/src/' + specifier.slice(2) : '';
    else {
      const name = [...packages.keys()].sort((a, b) => b.length - a.length).find(name => specifier === name || specifier.startsWith(name + '/'));
      if (!name) return undefined;
      const subpath = specifier.slice(name.length + 1);
      path = packages.get(name)! + '/src/' + (subpath.startsWith('src/') ? subpath.slice(4) : subpath || 'index');
    }
    const stem = path.replace(/\.[cm]?js$/, '');
    return [path, stem + '.ts', stem + '.tsx', stem + '.mts', path + '.ts', path + '.tsx', path + '.mjs', path + '/index.ts', path + '/index.tsx'].find(candidate => files.has(candidate));
  };
}

export function importsOf(file: string, source: string): Array<{ specifier: string; typeOnly: boolean; dynamic: boolean }> {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const edges: ReturnType<typeof importsOf> = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
      const typeOnly = ts.isImportDeclaration(node)
        ? !!clause && (clause.isTypeOnly || !clause.name && !!clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(part => part.isTypeOnly))
        : node.isTypeOnly || !!node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every(part => part.isTypeOnly);
      edges.push({ specifier: node.moduleSpecifier.text, typeOnly, dynamic: false });
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      edges.push({ specifier: node.argument.literal.text, typeOnly: true, dynamic: false });
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require') && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      edges.push({ specifier: node.arguments[0].text, typeOnly: false, dynamic: true });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return edges;
}

export function cyclesOf(graph: Map<string, Edge[]>, includeTypes: boolean, includeDynamic: boolean): string[][] {
  let sequence = 0;
  const indices = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], active = new Set<string>(), cycles: string[][] = [];
  const visit = (file: string): void => {
    indices.set(file, sequence); low.set(file, sequence++); stack.push(file); active.add(file);
    const edges = (graph.get(file) ?? []).filter(edge => (includeTypes || !edge.typeOnly) && (includeDynamic || !edge.dynamic) && graph.has(edge.target));
    for (const { target } of edges) {
      if (!indices.has(target)) { visit(target); low.set(file, Math.min(low.get(file)!, low.get(target)!)); }
      else if (active.has(target)) low.set(file, Math.min(low.get(file)!, indices.get(target)!));
    }
    if (low.get(file) === indices.get(file)) {
      const group: string[] = [];
      let member: string;
      do { member = stack.pop()!; active.delete(member); group.push(member); } while (member !== file);
      if (group.length > 1 || edges.some(edge => edge.target === file)) cycles.push(group.sort());
    }
  };
  for (const file of graph.keys()) if (!indices.has(file)) visit(file);
  return cycles.sort((a, b) => a[0].localeCompare(b[0]));
}

function featureOf(file: string): string | undefined {
  return /^(apps\/web\/src\/v8\/[^/]+|apps\/worker\/src\/features\/[^/]+|packages\/[^/]+\/src\/[^/.]+)\//.exec(file)?.[1];
}

/** Analyze real syntax and dependency edges; no per-file exemptions or line-count ceilings. */
export function auditStructure(files: SourceMap, packages = new Map<string, string>()) {
  const findings: Finding[] = [], graph = new Map<string, Edge[]>(), resolveModule = moduleResolver(files, packages);
  for (const [file, source] of files) {
    if (!sourcePath.test(file)) continue;
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const stem = posix.basename(file).replace(/\.[cm]?[jt]sx?$/, '').replace(/\.d$/, '');
    const forwarding = ast.statements.length > 0 && ast.statements.every(statement => ts.isExportDeclaration(statement) || ts.isEmptyStatement(statement) || ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression));
    // Published component entry points retain their external spelling. Other
    // implementation names follow the same kebab-case convention as their peers.
    const componentEntry = pascal.test(stem) && (forwarding || /\/components\/ui\//.test(file));
    if (!componentEntry && !stem.split('.').every(part => kebab.test(part))) findings.push({ rule: 'file-name', file, detail: 'ファイル名は kebab-case' });
    const folders = file.split('/').slice(0, -1);
    for (const name of folders) {
      if (name.split('.').every(part => kebab.test(part)) || /^\([^/]+\)$|^\[.+\]$|^__\w+__$|^@[-a-z0-9]+$/.test(name)) continue;
      findings.push({ rule: 'folder-name', file, detail: `フォルダ名は kebab-case: ${name}` });
    }
    for (const statement of ast.statements) {
      if ((ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isEnumDeclaration(statement)) && !pascal.test(statement.name.text)) {
        findings.push({ rule: 'type-name', file, detail: `型名は PascalCase: ${statement.name.text}` });
      }
    }
    const edges = importsOf(file, source).flatMap(edge => {
      const target = resolveModule(file, edge.specifier);
      return target ? [{ ...edge, target }] : [];
    });
    const feature = featureOf(file);
    const compatibilityEntry = forwarding && !feature && (
      /^packages\/[^/]+\/src\/[^/]+\.ts$/.test(file)
      || /^apps\/worker\/src\/services\//.test(file)
      || /^apps\/web\/src\/app\//.test(file)
    );
    for (const edge of edges) {
      const targetFeature = featureOf(edge.target);
      const configurationLink = /\.config\.[cm]?[jt]s$/.test(file) && /\.config\.[cm]?[jt]s$/.test(edge.target);
      if (targetFeature && targetFeature !== feature && (targetFeature.startsWith('apps/') || files.has(targetFeature + '/index.ts')) && !/\/index\.[jt]sx?$/.test(edge.target) && !compatibilityEntry && !configurationLink && !testPath.test(file) && !(nextEntry.test(file) && edge.target.startsWith('apps/web/src/v8/'))) {
        findings.push({ rule: 'public-entry', file, target: edge.target, detail: '機能の外からは公開 index を使う' });
      }
      if (feature && edge.target === feature + '/index.ts' && !testPath.test(file)) findings.push({ rule: 'self-barrel', file, target: edge.target, detail: '機能の中から自分の公開 index を読み戻さない' });
      if (nextEntry.test(file) && edge.target.startsWith('apps/web/src/v8/') && /\/index\.tsx?$/.test(edge.target) && !edge.typeOnly) findings.push({ rule: 'next-entry', file, target: edge.target, detail: 'Next の入口は画面を直接読む' });
      if (/^apps\/worker\/src\/(?:index\.ts|routes\/)/.test(file) && /^apps\/worker\/src\/routes\/(?:.*\/)?index\.ts$/.test(edge.target)) findings.push({ rule: 'route-entry', file, target: edge.target, detail: 'HTTP の登録は route を直接読む' });
    }
    if (!testPath.test(file) && !file.startsWith('scripts/') && !file.endsWith('.d.ts')) graph.set(file, edges);
  }
  const cycles = {
    runtime: cyclesOf(graph, false, true),
    withTypes: cyclesOf(graph, true, true),
    staticRuntime: cyclesOf(graph, false, false),
    staticWithTypes: cyclesOf(graph, true, false),
  };
  for (const cycle of cycles.withTypes) findings.push({ rule: 'cycle', file: cycle[0], detail: cycle.join(' → ') });
  return { findings, cycles, files: files.size, edges: [...graph.values()].reduce((sum, edges) => sum + edges.length, 0) };
}

export function auditRepository(root: string) {
  const files = repositorySources(root);
  const manifests = execFileSync('git', ['ls-files', 'packages/*/package.json'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const packages = new Map(manifests.map(path => [JSON.parse(readFileSync(resolve(root, path), 'utf8')).name as string, posix.dirname(path)]));
  return auditStructure(files, packages);
}
