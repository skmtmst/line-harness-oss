import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as shared from './index.js';
import * as legacyTypes from './types.js';
import { FRIEND_ADD_ROUTING_DEFAULT } from './types/friend-add.js';

describe('共有型の公開入口', () => {
  it('型だけの公開名を実行時の値へ変えず、既定の振り分けを同じ値で渡す', () => {
    expect(Object.keys(legacyTypes)).toEqual(['FRIEND_ADD_ROUTING_DEFAULT']);
    expect(legacyTypes.FRIEND_ADD_ROUTING_DEFAULT).toBe(FRIEND_ADD_ROUTING_DEFAULT);
    expect(shared.FRIEND_ADD_ROUTING_DEFAULT).toBe(FRIEND_ADD_ROUTING_DEFAULT);
    expect(FRIEND_ADD_ROUTING_DEFAULT).toEqual({
      firstTime: { scenarioId: null, timing: 'immediate', actions: [] },
      returning: { scenarioId: null, mode: 'same', startPosition: 'beginning', actions: [] },
      criteria: { firstTime: 'unfollow_count_zero' },
    });
  });

  it('型専用の参照・再公開も含め、共有ソースに循環参照を持たない', () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const config = ts.readConfigFile(join(root, '../tsconfig.json'), ts.sys.readFile);
    const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve(root, '..'));
    const graph = new Map<string, Set<string>>();
    function scan(directory: string) {
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        const file = join(directory, item.name);
        if (item.isDirectory()) { scan(file); continue; }
        if (!item.name.endsWith('.ts') || item.name.endsWith('.test.ts')) continue;
        const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        const dependencies = new Set<string>();
        function visit(node: ts.Node) {
          let specifier: string | undefined;
          if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
              node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            specifier = node.moduleSpecifier.text;
          } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) &&
                     ts.isStringLiteral(node.argument.literal)) {
            specifier = node.argument.literal.text;
          }
          if (specifier?.startsWith('.')) {
            const target = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule;
            expect(target, `${file}: ${specifier}`).toBeDefined();
            if (target) dependencies.add(target.resolvedFileName);
          }
          ts.forEachChild(node, visit);
        }
        visit(source);
        graph.set(file, dependencies);
      }
    }
    scan(root);
    const done = new Set<string>();
    function walk(file: string, route: string[]) {
      expect(route, `循環参照: ${[...route, file].join(' -> ')}`).not.toContain(file);
      if (done.has(file)) return;
      for (const dependency of graph.get(file) ?? []) walk(dependency, [...route, file]);
      done.add(file);
    }
    for (const file of graph.keys()) walk(file, []);
  });
});
