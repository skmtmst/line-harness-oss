import { describe, expect, test } from 'vitest';
import { auditStructure, importsOf, type SourceMap } from './audit.js';

const root = 'apps/web/src/v8/orders';
const fixture = (): SourceMap => new Map([
  [root + '/index.ts', "export { OrderList } from './list'"],
  [root + '/list.tsx', "import { formatOrder } from './model'; export const OrderList = () => formatOrder()"],
  [root + '/model.ts', "export function formatOrder() { return 'order' }"],
  ['apps/web/src/v8/dashboard/main.ts', "import { OrderList } from '@/v8/orders'; export const showOrders = OrderList"],
]);
const rules = (files: SourceMap) => auditStructure(files).findings.map(hit => hit.rule);

describe('構成の境界を実際の依存から守る', () => {
  test('公開入口と内部の直接importは両立する', () => {
    expect(rules(fixture())).toEqual([]);
  });
  test.each(['./BadName.ts', './bad_name.ts'])('名前をわざと %s にすると検出し、復旧すると通る', name => {
    const files = fixture();
    files.set(root + '/' + name, 'export const value = 1');
    expect(rules(files)).toContain('file-name');
    files.delete(root + '/' + name);
    expect(rules(files)).toEqual([]);
  });
  test('新しい大文字フォルダと型の小文字名を検出する', () => {
    const files = fixture();
    files.set(root + '/BadFolder/model.ts', 'type wrongName = string');
    expect(rules(files)).toEqual(expect.arrayContaining(['folder-name', 'type-name']));
  });
  test('外からの相対・alias・動的importが公開入口を飛ばす故障を検出する', () => {
    for (const source of ["import { OrderList } from '../orders/list'", "import { OrderList } from '@/v8/orders/list'", "const load = () => import('@/v8/orders/list')", "export { OrderList } from '../orders/list'"]) {
      const files = fixture();
      files.set('apps/web/src/v8/dashboard/main.ts', source);
      expect(rules(files)).toContain('public-entry');
      files.set('apps/web/src/v8/dashboard/main.ts', "import { OrderList } from '@/v8/orders'");
      expect(rules(files)).toEqual([]);
    }
  });
  test('公開入口が無い新しいアプリ機能への直接読込も検出する', () => {
    const files = fixture();
    files.delete(root + '/index.ts');
    files.set('apps/web/src/v8/dashboard/main.ts', "import { OrderList } from '@/v8/orders/list'");
    expect(rules(files)).toContain('public-entry');
  });
  test('機能内部から自分のbarrelへ戻る故障を検出する', () => {
    const files = fixture();
    files.set(root + '/model.ts', "import { OrderList } from './index'; export const formatOrder = OrderList");
    expect(rules(files)).toEqual(expect.arrayContaining(['self-barrel', 'cycle']));
  });
  test('基盤フォルダの透明な再exportからも、機能の内部へ抜けられない', () => {
    const files = fixture();
    files.set('apps/web/src/lib/shortcut.ts', "export { OrderList } from '@/v8/orders/list'");
    expect(rules(files)).toContain('public-entry');
    files.set('apps/web/src/lib/shortcut.ts', "export { OrderList } from '@/v8/orders'");
    expect(rules(files)).toEqual([]);
  });
  test.each([
    ["import { b } from './b.js'", "import { a } from './a.js'", false],
    ["export { b } from './b.js'", "export { a } from './a.js'", false],
    ["export const a = () => import('./b.js')", "export const b = () => import('./a.js')", false],
    ["export const a = () => require('./b.js')", "export const b = () => require('./a.js')", false],
    ["import type { B } from './b.js'; export type A = B", "import type { A } from './a.js'; export type B = A", true],
    ["export type A = import('./b.js').B", "export type B = import('./a.js').A", true],
  ])('静的・再export・動的・require・型の循環と復旧を確認する (%s)', (a, b, onlyTypes) => {
    const files = new Map([['packages/shared/src/a.ts', a], ['packages/shared/src/b.ts', b]]);
    const broken = auditStructure(files);
    expect(broken.cycles.withTypes).toHaveLength(1);
    expect(broken.cycles.runtime).toHaveLength(onlyTypes ? 0 : 1);
    files.set('packages/shared/src/b.ts', 'export const b = 1; export type B = string');
    expect(rules(files)).toEqual([]);
  });
  test('実行設定同士は設定を直接読み、製品からの内部読込は引き続き検出する', () => {
    const files = fixture();
    files.set(root + '/browser.config.mjs', 'export default {}');
    files.set('scripts/browser/isolated.config.mjs', "import config from '../../apps/web/src/v8/orders/browser.config.mjs'; export default config");
    expect(rules(files)).toEqual([]);
    files.set('scripts/browser/isolated.config.mjs', "import { OrderList } from '../../apps/web/src/v8/orders/list'; export default OrderList");
    expect(rules(files)).toContain('public-entry');
  });
  test('workspace package入口の循環も同じグラフで見つける', () => {
    const files = new Map([
      ['packages/a/src/index.ts', "import { b } from '@example/b'; export const a = b"],
      ['packages/b/src/index.ts', "import { a } from '@example/a'; export const b = a"],
    ]);
    expect(auditStructure(files, new Map([['@example/a', 'packages/a'], ['@example/b', 'packages/b']])).cycles.runtime).toHaveLength(1);
  });
  test('Nextの入口は画面へ直接つなぎ、Workerのroute登録へbarrelを持ち込めない', () => {
    const files = fixture();
    files.set('apps/web/src/app/page.tsx', "import { OrderList } from '@/v8/orders/list'");
    expect(rules(files)).toEqual([]);
    files.set('apps/web/src/app/page.tsx', "import { OrderList } from '@/v8/orders'");
    expect(rules(files)).toContain('next-entry');
    files.set('apps/web/src/app/page.tsx', "import { OrderList } from '@/v8/orders/list'");
    files.set('apps/worker/src/index.ts', "import { route } from './routes/orders/index.js'");
    files.set('apps/worker/src/routes/orders/index.ts', 'export const route = 1');
    expect(rules(files)).toContain('route-entry');
    files.set('apps/worker/src/index.ts', "import { route } from './routes/index.js'");
    files.set('apps/worker/src/routes/index.ts', 'export const route = 1');
    expect(rules(files)).toContain('route-entry');
  });
  test('試験は公開入口を使う利用側として扱い、本体から試験への循環に置換しない', () => {
    const files = fixture();
    files.set(root + '/list.test.ts', "import { OrderList } from './index'");
    expect(rules(files)).toEqual([]);
  });
  test('import typeと個別type指定を値の依存に数えない', () => {
    expect(importsOf('model.ts', "import { type Model } from './a'; import { type A, b } from './b'"))
      .toEqual([{ specifier: './a', typeOnly: true, dynamic: false }, { specifier: './b', typeOnly: false, dynamic: false }]);
  });
});
