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
interface Update {
  key: string
  source: 'deployment' | 'day' | 'archive'
  version: string
  at: string | null
  latest: boolean
  counts: { added: number; changed: number; fixed: number }
  entryCount: number
  highlights: string[]
}
interface Log {
  releases: Array<{ version: string; released: string | null; entryCount?: number; entries: Entry[] }>
  updates?: Update[]
  pending?: { entryCount: number; counts: Update['counts'] }
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
  const build = (env: Record<string, string> = {}) => {
    execFileSync(process.execPath, [script], { env: { ...process.env, RELEASE_LOG_DEPLOYMENTS: '', ...env }, stdio: 'pipe' })
    const read = (name: string): Log => JSON.parse(readFileSync(join(root, 'apps/web/src/generated', name), 'utf8'))
    return { full: read('release-log.json'), summary: read('release-log-summary.json') }
  }
  return { put, build, root }
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

const version = (v: string, released: string, extra = '') => `---\nversion: ${v}\nreleased: ${released}\n${extra}---\n`
const counts = (u: Update) => [u.counts.added, u.counts.changed, u.counts.fixed]

describe('更新履歴の回ごとの要約（検証への配備1回ごと・記録が無ければ日ごと）', () => {
  it('配備の記録が無いと日本時間の日ごとに区切り、種類の数・日時・最新を載せる', () => {
    const { put, build } = fixture()
    put('0.24.0.md', version('0.24.0', '2026-09-02 10:00') + [
      '## 追加', '- 新しい画面 @kenta #1 2026-09-01 23:50', '- 別の画面 @kenta #2 2026-09-01 09:00',
      '## 修正', '- 直した @kenta #3 2026-09-02 00:10', '',
    ].join('\n'))
    put('0.25.0.md', version('0.25.0', '2026-09-05 12:00') + '## 変更\n- 言葉を変えた @kenta #4\n')
    const { summary } = build()
    expect(summary.updates?.map((u) => [u.key, u.source, u.at, u.latest, ...counts(u), u.entryCount])).toEqual([
      ['day|2026-09-05|0.25.0', 'day', '2026-09-05T12:00+09:00', true, 0, 1, 0, 1],
      ['day|2026-09-02|0.24.0', 'day', '2026-09-02T00:10+09:00', false, 0, 0, 1, 1],
      ['day|2026-09-01|0.24.0', 'day', '2026-09-01T23:50+09:00', false, 2, 0, 0, 2],
    ])
    expect(summary.updates?.every((u) => u.highlights.length === 0)).toBe(true)
  })

  it('3行のまとめは版の highlights: だけから取り、その版のいちばん新しい回に載せる', () => {
    const { put, build } = fixture()
    put('0.24.0.md', version('0.24.0', '2026-09-02 10:00', 'highlights:\n  - 予約の画面を作り直した\n  - "配信の宛先を選びやすくした"\n') + body(2, '行', '2026-09-01 10:00') + '- 翌日 @kenta #9 2026-09-02 09:00\n')
    put('0.25.0.md', version('0.25.0', '2026-09-05 12:00') + body(1, '書いていない版', '2026-09-05 11:00'))
    put('unreleased/7-kenta-x.md', '---\nversion: 0.24.0\nhighlights:\n  - PRのファイルには書かない\n---\n## 追加\n- 未公開 @kenta #7 2026-09-06 10:00\n')
    const { summary, full } = build()
    expect(summary.updates?.map((u) => [u.key, u.highlights])).toEqual([
      ['day|2026-09-05|0.25.0', []],
      ['day|2026-09-02|0.24.0', ['予約の画面を作り直した', '配信の宛先を選びやすくした']],
      ['day|2026-09-01|0.24.0', []],
    ])
    expect(JSON.stringify(summary)).not.toContain('PRのファイルには書かない')
    expect(full.releases.every((r) => !('highlights' in r))).toBe(true)
  })

  it('highlights: が壊れていてもビルドは通り、空にする（4行目からは捨てる）', () => {
    const { put, build } = fixture()
    put('0.23.0.md', version('0.23.0', '2026-08-01 10:00', 'highlights: 1行に書いてしまった\n') + body(1, 'a', '2026-08-01 09:00'))
    put('0.24.0.md', version('0.24.0', '2026-09-01 10:00', 'highlights:\n  - 一\n  - 二\n  - 三\n  - 四\n') + body(1, 'b', '2026-09-01 09:00'))
    const { summary } = build()
    expect(summary.updates?.map((u) => u.highlights)).toEqual([['一', '二', '三'], []])
  })

  it('配備の記録を渡すと配備1回ごとに区切る。失敗・本番の配備は数えず、記録の外は日ごと', () => {
    const { put, build, root } = fixture()
    put('0.24.0.md', version('0.24.0', '2026-09-10 10:00') + [
      '## 追加', '- 記録より前 @kenta #1 2026-09-01 10:00', '- 1回目で入った @kenta #2 2026-09-02 10:00',
      '## 修正', '- これも1回目 @kenta #3 2026-09-03 08:00', '- 失敗の配備より前 @kenta #4 2026-09-03 20:00', '- 本番の配備より前 @kenta #6 2026-09-04 08:00',
      '- 最後の配備より後 @kenta #5 2026-09-09 10:00', '',
    ].join('\n'))
    const deployments = join(root, 'deployments.json')
    writeFileSync(deployments, JSON.stringify([
      { at: '2026-09-01T03:00:00Z', environment: 'staging', phase: 'succeeded' },
      { at: '2026-09-03T00:00:00Z', environment: 'staging', phase: 'succeeded' },
      { at: '2026-09-03T12:00:00Z', environment: 'staging', phase: 'failed' },
      { at: '2026-09-04T00:00:00Z', environment: 'production', phase: 'succeeded' },
      { at: '2026-09-05T00:00:00Z', environment: 'staging', phase: 'succeeded' },
    ]))
    const { summary } = build({ RELEASE_LOG_DEPLOYMENTS: deployments })
    expect(summary.updates?.map((u) => [u.source, u.at, u.entryCount, ...counts(u)])).toEqual([
      ['day', '2026-09-09T10:00+09:00', 1, 0, 0, 1],
      ['deployment', '2026-09-05T09:00+09:00', 2, 0, 0, 2],
      ['deployment', '2026-09-03T09:00+09:00', 2, 1, 0, 1],
      ['day', '2026-09-01T10:00+09:00', 1, 1, 0, 0],
    ])
  })

  it('配備の記録が読めなくてもビルドは通り、日ごとに区切る', () => {
    const { put, build, root } = fixture()
    put('0.24.0.md', version('0.24.0', '2026-09-02 10:00') + body(2, '行', '2026-09-01 10:00'))
    const broken = join(root, 'broken.json')
    writeFileSync(broken, '{ 壊れている')
    for (const path of [broken, join(root, 'missing.json')]) {
      expect(build({ RELEASE_LOG_DEPLOYMENTS: path }).summary.updates?.map((u) => [u.source, u.entryCount])).toEqual([['day', 2]])
    }
  })

  it('保管用の版は日付で割らず1回にまとめ、次回反映予定は回に入れず件数だけ出す', () => {
    const { put, build } = fixture()
    put('0.24.0.md', version('0.24.0', '2026-09-01 10:00') + body(1, '前', '2026-09-01 09:00'))
    put('0.25.0.md', version('0.25.0', '2026-10-14 02:05', 'summary: false\n') + body(3, '一日目', '2026-10-01 10:00') + '## 追加\n- 二日目 @kenta #9 2026-10-02 10:00\n')
    put('unreleased.md', '## 追加\n- 古い未公開 @kenta #8 2026-10-15 10:00\n')
    put('unreleased/10-kenta-x.md', '## 変更\n- 新しい未公開 @kenta #10 2026-10-16 10:00\n')
    const { summary } = build()
    expect(summary.updates?.map((u) => [u.key, u.source, u.latest, u.entryCount, ...counts(u)])).toEqual([
      ['archive|0.25.0', 'archive', true, 4, 1, 0, 3],
      ['day|2026-09-01|0.24.0', 'day', false, 1, 0, 0, 1],
    ])
    expect(summary.pending).toEqual({ entryCount: 2, counts: { added: 1, changed: 1, fixed: 0 } })
  })
})
