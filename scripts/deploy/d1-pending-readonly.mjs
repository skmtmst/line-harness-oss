import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function selectD1(database, sql) {
  if (!/^SELECT\b/i.test(sql) || sql.includes(';')) throw new Error('読み取り専用のSELECTだけを指定してください')
  const result = spawnSync('npx', ['wrangler', 'd1', 'execute', database, '--remote', '--command', sql, '--json'], { encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error('D1の読み取りに失敗しました。未適用数は不明です')
  const body = JSON.parse(result.stdout)
  if (!Array.isArray(body) || body.length !== 1 || body[0]?.success !== true || !Array.isArray(body[0].results)) {
    throw new Error('D1の応答が不正です。未適用数は不明です')
  }
  return body[0].results
}

export function pendingMigrations(files, rows) {
  if (rows.some(row => typeof row?.name !== 'string')) throw new Error('適用済み台帳の応答が不正です')
  const applied = new Set(rows.map(row => row.name))
  const pending = files.filter(name => /^\d{3,}_[A-Za-z0-9_-]+\.sql$/.test(name) && !applied.has(name))
    .sort((a, b) => Number(a.split('_')[0]) - Number(b.split('_')[0]) || a.localeCompare(b))
  return { count: pending.length, pending }
}

export function readPending(database, dir = 'packages/db/migrations', select = selectD1) {
  // 台帳が無くても作らない。読み取り失敗は0件として扱わない。
  const tables = select(database, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_migrations'")
  if (tables.some(row => row?.name !== '_migrations')) throw new Error('台帳の有無を確認できませんでした')
  const rows = tables.length ? select(database, 'SELECT name FROM _migrations') : []
  return { ...pendingMigrations(readdirSync(dir), rows), ledgerExists: tables.length > 0 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [database, dir] = process.argv.slice(2)
  if (!database) throw new Error('使い方: d1-pending-readonly.mjs <D1名> [migrationディレクトリ]')
  console.log(JSON.stringify(readPending(database, dir)))
}
