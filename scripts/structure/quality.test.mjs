import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const empty = Object.fromEntries(['screen-fetch', 'screen-staff-me', 'route-500', 'utc-date-slice', 'history-comment', 'history-name', 'history-test-title', 'cycle', 'long-files', 'long-file-lines', 'source-assertion'].map(rule => [rule, 0]))
const baselinePath = 'scripts/structure/quality-baseline.json'
function fixture(run, initial = {}, baseline = empty) {
  const root = mkdtempSync(join(tmpdir(), 'quality-ratchet-'))
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim()
  const put = (path, source) => { mkdirSync(dirname(join(root, path)), {recursive: true}); writeFileSync(join(root, path), source) }
  try {
    git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid')
    put(baselinePath, JSON.stringify(baseline))
    for (const [path, source] of Object.entries(initial)) put(path, source)
    git('add', '.'); git('commit', '-qm', 'base')
    const base = git('rev-parse', 'HEAD')
    const cli = (...args) => spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(new URL('./quality-check.mjs', import.meta.url)), '--base', base, '--json', ...args], {cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024})
    run({root, put, cli})
  } finally { rmSync(root, {recursive: true, force: true}) }
}
for (const [rule, file, source] of [
  ['screen-fetch', 'apps/web/src/v8/sample/list.tsx', `fetch('/api/sample')`],
  ['screen-fetch', 'apps/liff/src/list.tsx', `window['fetch']('/api/sample')`],
  ['screen-staff-me', 'apps/web/src/v8/sample/model.ts', `api.staff.me()`],
  ['route-500', 'apps/worker/src/routes/sample.ts', `c.json({success:false},500)`],
  ['route-500', 'apps/worker/src/routes/sample.ts', `new Response('error',{status:500})`],
  ['route-500', 'apps/worker/src/features/sample/route.ts', `Response.json({success:false},{status:500})`],
  ['utc-date-slice', 'packages/shared/src/sample.ts', `new Date().toISOString().slice(0,10)`],
  ['history-comment', 'apps/web/src/v8/sample/list.tsx', `// B-123: 前は壊れていた\nexport const x=1`],
  ['history-comment', 'apps/web/src/v8/sample/list.module.css', `/* 司令塔の指摘 */`],
  ['history-name', 'apps/web/src/v8/sample/B-123.test.ts', `export const x=1`],
  ['history-test-title', 'apps/worker/src/sample.test.ts', `it('B-123で直した',()=>{})`],
  ['long-files', 'scripts/sample.ts', Array(1500).fill('const x = 1').join('\n')],
  ['long-file-lines', 'scripts/sample.ts', Array(1500).fill('const x = 1').join('\n')],
  ...['apps/web/src/sample.test.ts', 'apps/worker/src/sample.test.ts', 'apps/liff/src/sample.test.ts', 'scripts/sample.test.mjs'].map(file => ['source-assertion', file, `import {readFileSync} from 'node:fs';import {it,expect} from 'vitest';const source=readFileSync('sample.ts');it('shape',()=>expect(source).toContain('return true'))`]),
]) test(`${rule} rejects an added violation in ${file}, including a baseline update`, () => fixture(({put, cli}) => {
  assert.equal(cli().status, 0)
  put(file, source)
  const red = cli()
  assert.equal(red.status, 1, red.stderr)
  assert.ok(JSON.parse(red.stdout).counts[rule] > 0)
  assert.equal(cli('--update').status, 1)
}))

test('type, runtime, re-export and dynamic cycles cannot be introduced', () => {
  for (const source of ["import {b} from './b';export const a=b", "export {b as a} from './b'", "export type A=import('./b').B"]) fixture(({put, cli}) => {
    put('apps/web/src/v8/sample/a.ts', source)
    put('apps/web/src/v8/sample/b.ts', "import type {A} from './a';export type B=A")
    const red = cli(); assert.equal(red.status, 1); assert.equal(JSON.parse(red.stdout).counts.cycle, 1)
  })
})

test('data strings and harmless comments are not source violations', () => fixture(({put, cli}) => {
  put('apps/web/src/v8/sample/list.tsx', `const sample="fetch('/api') B-123";const day=jstDate(new Date()); // 店舗のタイムゾーンを保つ\napi.tags.list()`)
  put('apps/web/src/v8/sample/list.module.css', `.sample::before {content: '/* B-123 */';}`)
  const result = cli(); assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout).counts, empty)
}))

test('a decrease requires reducing the snapshot; malformed or inflated snapshots fail', () => fixture(({root, put, cli}) => {
  put('apps/web/src/v8/sample/list.tsx', `fetch('/api/sample')`)
  assert.equal(cli().status, 1)
  assert.equal(cli('--update').status, 0)
  assert.equal(JSON.parse(readFileSync(join(root, baselinePath), 'utf8'))['screen-fetch'], 1)
  assert.equal(cli().status, 0)
  put(baselinePath, JSON.stringify({...empty, 'screen-fetch': 3})); assert.equal(cli().status, 1)
  put(baselinePath, JSON.stringify({...empty, 'screen-fetch': 1, allowed: 1})); assert.equal(cli().status, 1)
  put(baselinePath, JSON.stringify({...empty, 'screen-fetch': 1, cycle: -1})); assert.equal(cli().status, 1)
}, {'apps/web/src/v8/sample/list.tsx': `fetch('/api/first');fetch('/api/second')`}, {...empty, 'screen-fetch': 2}))

test('removing a deliberately added violation restores green and failed updates do not write', () => fixture(({root, put, cli}) => {
  assert.equal(cli().status, 0)
  put('apps/web/src/v8/sample/list.tsx', `fetch('/api/sample')`)
  assert.equal(cli().status, 1)
  assert.equal(cli('--update').status, 1)
  assert.deepEqual(JSON.parse(readFileSync(join(root, baselinePath), 'utf8')), empty)
  put('apps/web/src/v8/sample/list.tsx', 'export const x=1\n')
  assert.equal(cli().status, 0)
}))
