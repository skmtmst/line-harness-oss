import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { scaffoldFiles, writeScaffold } from './new.js';

function compile(source: string, fileName: string, imports: Record<string, unknown>) {
  const output = ts.transpileModule(source, { fileName, reportDiagnostics: true, compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022} });
  expect(output.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error)).toEqual([]);
  const exports: Record<string, (...args: any[]) => any> = {};
  runInNewContext(output.outputText, { exports, require: (id: string) => {
    if (!(id in imports)) throw Error(`unexpected dependency ${id}`);
    return imports[id];
  } });
  return exports;
}

describe('new feature scaffolds', () => {
  it('screen uses the list template and hides write actions until authorized', () => {
    const webRequire = createRequire(join(process.cwd(), 'apps/web/package.json'));
    const React = webRequire('react');
    const { renderToStaticMarkup } = webRequire('react-dom/server');
    let role: string | null = null;
    const files = scaffoldFiles({kind: 'screen', name: 'sample-list', title: '一覧', board: 'TestBoard'});
    const source = files.get('apps/web/src/v8/sample-list/list.tsx')!;
    const { SampleListList } = compile(source, 'list.tsx', {
      'react/jsx-runtime': webRequire('react/jsx-runtime'),
      '@/lib/staff-role': {useStaffRole: () => role, canManageRole: (value: string) => value === 'owner' || value === 'admin'},
      '@/components/templates': {ListPage: ({children, actions, readOnly}: any) => React.createElement('main', {}, readOnly && '閲覧のみ', actions, children)},
    });
    const render = () => renderToStaticMarkup(React.createElement(SampleListList, {actions: React.createElement('button', {}, '保存する'), children: 'データ'}));
    expect(render()).not.toContain('保存する');
    role = 'viewer'; expect(render()).toContain('閲覧のみ'); expect(render()).not.toContain('保存する');
    role = 'owner'; expect(render()).toContain('保存する'); expect(render()).toContain('データ');
  });

  it('route executes its injected handler only after role and read-only guards; errors propagate', async () => {
    const workerRequire = createRequire(join(process.cwd(), 'apps/worker/package.json'));
    const { Hono } = workerRequire('hono');
    const { requireRole, denyReadOnly } = compile(readFileSync(join(process.cwd(), 'apps/worker/src/middleware/role-guard.ts'), 'utf8'), 'role-guard.ts', {
      '@line-crm/shared': {},
    });
    for (const method of ['get', 'post', 'patch', 'delete'] as const) {
      const source = scaffoldFiles({kind: 'route', name: 'sample', method}).get('apps/worker/src/routes/sample.ts')!;
      const { createSampleRoutes } = compile(source, 'sample.ts', {hono: {Hono}, '../middleware/role-guard.js': {requireRole, denyReadOnly}});
      let staff: any = null, calls = 0;
      const app = new Hono();
      app.use('*', async (c: any, next: () => Promise<void>) => {c.set('staff', staff); await next();});
      app.onError((_error: Error, c: any) => c.json({incident: 'common-handler'}, 500));
      app.route('/', createSampleRoutes((c: any) => {calls++; if (c.req.query('fail')) throw Error('failure'); return c.json({success: true});}));
      for (const identity of [null, {role: 'viewer'}, {role: 'staff'}, {role: 'owner', readOnly: true}]) {
        staff = identity;
        expect((await app.request('/api/sample', {method: method.toUpperCase()})).status).toBe(403);
      }
      expect(calls).toBe(0);
      staff = {role: 'admin', readOnly: false};
      expect(await (await app.request('/api/sample', {method: method.toUpperCase()})).json()).toEqual({success: true});
      expect(await (await app.request('/api/sample?fail=1', {method: method.toUpperCase()})).json()).toEqual({incident: 'common-handler'});
      expect(calls).toBe(2);
    }
  });

  it('dry-run writes nothing, rejects traversal and never overwrites a file', () => {
    const root = mkdtempSync(join(tmpdir(), 'scaffold-'));
    try {
      const options = {kind: 'screen' as const, name: 'sample', title: '一覧', board: 'TestBoard'};
      const paths = writeScaffold(root, options, true);
      expect(paths.every(path => !existsSync(path))).toBe(true);
      const blocker = paths[1]; mkdirSync(dirname(blocker), {recursive: true}); writeFileSync(blocker, 'owned');
      expect(() => writeScaffold(root, options)).toThrow('Refusing to overwrite');
      expect(existsSync(paths[0])).toBe(false);
      expect(readFileSync(blocker, 'utf8')).toBe('owned');
      expect(() => scaffoldFiles({...options, name: '../escape'})).toThrow();
      expect(() => scaffoldFiles({...options, board: ''})).toThrow();
      const written = writeScaffold(root, {kind: 'route', name: 'sample'});
      expect(written.every(existsSync)).toBe(true);
    } finally { rmSync(root, {recursive: true, force: true}); }
  });

  it('a linked source directory cannot write into another worktree', () => {
    const root = mkdtempSync(join(tmpdir(), 'scaffold-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'scaffold-neighbor-'));
    try {
      symlinkSync(outside, join(root, 'apps'), 'dir');
      expect(() => writeScaffold(root, {kind: 'route', name: 'sample'})).toThrow('linked directory');
      expect(existsSync(join(outside, 'worker/src/routes/sample.ts'))).toBe(false);
    } finally {rmSync(root, {recursive: true, force: true}); rmSync(outside, {recursive: true, force: true});}
  });
});
