import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

interface Entry {
  kind: string
  text: string
  by: string | null
  pr: number | null
  at: string | null
}
interface Log {
  releases: Array<{ version: string; released: string | null; entryCount?: number; entries: Entry[] }>
}

const sandboxes: string[] = []
afterEach(() => sandboxes.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'release-log-test-'))
  sandboxes.push(root)
  const docs = join(root, 'docs/release-log')
  const script = join(root, 'apps/web/scripts/build-release-log.mjs')
  mkdirSync(join(docs, 'unreleased'), { recursive: true })
  mkdirSync(join(root, 'apps/web/scripts'), { recursive: true })
  copyFileSync(resolve('apps/web/scripts/build-release-log.mjs'), script)
  const put = (name: string, content: string) => writeFileSync(join(docs, name), content)
  const build = () => {
    execFileSync(process.execPath, [script])
    const read = (name: string): Log => JSON.parse(readFileSync(join(root, 'apps/web/src/generated', name), 'utf8'))
    return { full: read('release-log.json'), summary: read('release-log-summary.json') }
  }
  return { put, build }
}

function body(count: number, text: string, at: string) {
  return '## 修正\n' + Array.from({ length: count }, (_, i) => `- ${text}${i} @kenta #${i + 1} ${at}\n`).join('')
}
const rows = (log: Log) => log.releases.flatMap((release) => release.entries.map((entry) => ({
  version: release.version, released: release.released, ...entry,
})))

describe('反映履歴を版へまとめるときの要約', () => {
  it('未公開の行を版へまとめても、要約の50行と順番・全文の各行を保つ', () => {
    const { put, build } = fixture()
    put('0.23.0.md', '---\nversion: 0.23.0\nreleased: 2026-08-01\n---\n' + body(35, '古い変更', '2026-08-01 10:00'))
    put('0.24.0.md', '---\nversion: 0.24.0\nreleased: 2026-09-01\n---\n' + body(40, '反映済み', '2026-09-01 10:00'))
    put('unreleased.md', '## 追加\n')
    const pending = body(60, '未公開の変更', '2026-10-13 10:00')
    put('unreleased/100-kenta-pending.md', pending)
    const before = build()

    put('unreleased/100-kenta-pending.md', '## 修正\n')
    put('0.25.0.md', '---\nversion: 0.25.0\nreleased: 2026-10-14 02:05\nsummary: false\n---\n' + pending)
    const after = build()

    expect(rows(before.summary)).toHaveLength(50)
    expect(rows(after.summary)).toEqual(rows(before.summary))
    expect(after.summary.releases.find((r) => r.version === '0.25.0')).toMatchObject({ entryCount: 60, entries: [] })
    expect(after.full.releases.flatMap((r) => r.entries)).toEqual(before.full.releases.flatMap((r) => r.entries))
    expect(after.full.releases.find((r) => r.version === '0.25.0')?.entries).toHaveLength(60)
  })

  it('元の要約が50行未満なら、まとめても行を補充しない', () => {
    const { put, build } = fixture()
    put('0.24.0.md', '---\nversion: 0.24.0\nreleased: 2026-09-01\n---\n' + body(36, '反映済み', '2026-09-01 10:00'))
    const before = build()
    put('0.25.0.md', '---\nversion: 0.25.0\nreleased: 2026-10-14\nsummary: false\n---\n' + body(60, 'まとめた変更', '2026-10-13 10:00'))
    expect(rows(build().summary)).toEqual(rows(before.summary))
  })

  it('通常の新しい版は従来どおり日時で選び、まとめた版を外しても50行を埋める', () => {
    const { put, build } = fixture()
    put('0.24.0.md', '---\nversion: 0.24.0\nreleased: 2026-09-01\n---\n' + body(60, '前の版', '2026-09-01 10:00'))
    put('0.25.0.md', '---\nversion: 0.25.0\nreleased: 2026-10-14\nsummary: false\n---\n' + body(60, '保管した変更', '2026-10-13 10:00'))
    put('0.26.0.md', '---\nversion: 0.26.0\nreleased: 2026-10-15\n---\n' + body(10, '新しい版', '2026-10-15 10:00'))
    const { summary } = build()
    expect(summary.releases.map((r) => r.entries.length)).toEqual([10, 0, 40])
    expect(summary.releases.map((r) => r.entryCount)).toEqual([10, 60, 60])
  })
})
