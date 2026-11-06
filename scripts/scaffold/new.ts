import { mkdirSync, existsSync, writeFileSync, unlinkSync, realpathSync, lstatSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ScaffoldOptions = { kind: 'screen' | 'route'; name: string; title?: string; board?: string; method?: 'get' | 'post' | 'patch' | 'delete' };
export function scaffoldFiles(options: ScaffoldOptions): Map<string, string> {
  const { kind, name } = options;
  if (typeof name !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) throw Error('name must be a kebab-case feature name');
  const component = name.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('');
  if (kind === 'screen') {
    if (!options.title || !options.board || !/^[A-Za-z0-9]+$/.test(options.board)) throw Error('screen requires --title and --board <Pencil board ID>');
    return new Map([[`apps/web/src/v8/${name}/list.tsx`, `'use client'\n\nimport type { ReactNode } from 'react'\nimport { ListPage } from '@/components/templates'\nimport { useStaffRole, canManageRole } from '@/lib/staff-role'\n\nexport interface ${component}ListProps {\n  children: ReactNode\n  actions?: ReactNode\n}\n\nexport function ${component}List({ children, actions }: ${component}ListProps) {\n  const role = useStaffRole()\n  return <ListPage title={${JSON.stringify(options.title)}} boardId={${JSON.stringify(options.board)}}\n    readOnly={role === 'viewer'} actions={canManageRole(role) ? actions : undefined}>\n    {children}\n  </ListPage>\n}\n`],
    [`apps/web/src/v8/${name}/index.ts`, `export { ${component}List } from './list'\nexport type { ${component}ListProps } from './list'\n`]]);
  }
  if (kind !== 'route') throw Error('kind must be screen or route');
  const method = options.method ?? 'get';
  if (!['get', 'post', 'patch', 'delete'].includes(method)) throw Error('unsupported method');
  return new Map([[`apps/worker/src/routes/${name}.ts`, `import { Hono, type Handler } from 'hono';\nimport type { Env } from '../worker-env.js';\nimport { requireRole, denyReadOnly } from '../middleware/role-guard.js';\n\n/** 業務の実装を渡してからHTTP入口へ登録する。予期しない例外は共通のonErrorへ届く。 */\nexport function create${component}Routes(handler: Handler<Env>) {\n  const routes = new Hono<Env>();\n  routes.${method}('/api/${name}', requireRole('owner', 'admin'), denyReadOnly(), handler);\n  return routes;\n}\n`]]);
}
export function writeScaffold(root: string, options: ScaffoldOptions, dryRun = false): string[] {
  root = realpathSync(root);
  const files = scaffoldFiles(options);
  const paths = [...files.keys()].map(path => resolve(root, path));
  for (const path of paths) {
    if (relative(resolve(root), path).split(sep).includes('..') || existsSync(path)) throw Error(`Refusing to overwrite: ${path}`);
    for (let parent = dirname(path); parent !== root; parent = dirname(parent)) {
      if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) throw Error(`Refusing a linked directory: ${parent}`);
    }
  }
  if (dryRun) return paths;
  const created: string[] = [];
  try {
    for (const [path, source] of files) {
      const target = resolve(root, path);
      mkdirSync(dirname(target), { recursive: true });
      // 事前確認の後にほかの担当者が作ったファイルも上書きしない。
      writeFileSync(target, source, { flag: 'wx' });
      created.push(target);
    }
  } catch (error) {
    for (const path of created) unlinkSync(path);
    throw error;
  }
  return paths;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [kind, name, ...args] = process.argv.slice(2);
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    if (index < 0) return undefined;
    const result = args[index + 1];
    if (!result || result.startsWith('--')) throw Error(`${flag} needs a value`);
    return result;
  };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--dry-run') continue;
    if (!['--title', '--board', '--method'].includes(args[index])) throw Error(`Unknown flag: ${args[index]}`);
    index++;
  }
  if (kind !== 'screen' && kind !== 'route') throw Error('Use new:screen <name> --title <title> --board <ID>, or new:route <name> --method get');
  const paths = writeScaffold(process.cwd(), { kind, name, title: value('--title'), board: value('--board'), method: value('--method') as ScaffoldOptions['method'] }, args.includes('--dry-run'));
  for (const path of paths) console.log(path);
}
