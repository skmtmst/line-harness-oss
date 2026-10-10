import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
// @ts-expect-error JS CLI
import { pendingMigrations, readPending } from './d1-pending-readonly.mjs'

const dirs: string[] = []
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'd1-readonly-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'migrations'))
  for (const name of ['002_old.sql', '999_next.sql', '1000_latest.sql']) writeFileSync(join(dir, 'migrations', name), 'DDLは実行しない')
  return dir
}
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })))

describe('D1の未適用確認はSELECTだけ', () => {
  it.each([true, false])('台帳あり=%s でもCREATEを出さずに件数と一覧を返す', exists => {
    const dir = fixture()
    const queries: string[] = []
    const result = readPending('staging', join(dir, 'migrations'), (_db: string, query: string) => {
      queries.push(query)
      expect(query).toMatch(/^SELECT /)
      return query.includes('sqlite_master') ? (exists ? [{ name: '_migrations' }] : []) : [{ name: '002_old.sql' }]
    })
    expect(result.count).toBe(exists ? 2 : 3)
    expect(result.pending.slice(-2)).toEqual(['999_next.sql', '1000_latest.sql'])
    expect(result.ledgerExists).toBe(exists)
  })
  it('実際のCLIがwranglerへSELECTだけを渡し、認証・JSON失敗を0件にしない', () => {
    const dir = fixture()
    const log = join(dir, 'calls.jsonl')
    const stub = join(dir, 'npx')
    writeFileSync(stub, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.D1_TEST_LOG, JSON.stringify(args)+'\\n');
if (process.env.D1_TEST_FAILURE === 'auth') process.exit(1);
if (process.env.D1_TEST_FAILURE === 'json') { console.log('{}'); process.exit(0); }
const sql = args[args.indexOf('--command')+1];
if (!sql.startsWith('SELECT ') || sql.includes(';')) process.exit(99);
console.log(JSON.stringify([{success:true,results: sql.includes('sqlite_master') ? [{name:'_migrations'}] : [{name:'002_old.sql'}]}]));
`, { mode: 0o755 })
    const run = (failure = '') => spawnSync(process.execPath, ['scripts/deploy/d1-pending-readonly.mjs', 'staging', join(dir, 'migrations')], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, D1_TEST_LOG: log, D1_TEST_FAILURE: failure },
    })
    const good = run()
    expect(good.status).toBe(0)
    expect(JSON.parse(good.stdout).count).toBe(2)
    for (const failure of ['auth', 'json']) {
      const bad = run(failure)
      expect(bad.status).not.toBe(0)
      expect(bad.stdout).not.toContain('"count":0')
    }
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[])
    for (const args of calls) expect(args[args.indexOf('--command') + 1]).toMatch(/^SELECT /)
  })
  it('台帳の壊れた行は失敗とする', () => {
    expect(() => pendingMigrations(['001_a.sql'], [{}])).toThrow(/不正/)
  })
})
