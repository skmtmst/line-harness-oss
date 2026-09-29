import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const API = readFileSync(join(HERE, '..', '..', 'lib', 'api.ts'), 'utf8')
const ROUTE = readFileSync(
  join(HERE, '..', '..', '..', '..', 'worker', 'src', 'routes', 'users-grouped.ts'),
  'utf8',
)
const SERVICE = readFileSync(
  join(HERE, '..', '..', '..', '..', 'worker', 'src', 'services', 'users-grouped.ts'),
  'utf8',
)

/**
 * FRIEND-09: UID絞り込みは「表示中の50行」ではなく全件へかける。
 * 受け口（route）→ 全件への絞り込み（service）→ 送信（api）→
 * 画面（page）の4段がそろっていることを見る。
 */
describe('FRIEND-09 UID絞り込みは全件へかかる', () => {
  it('route が uid=linked|unlinked を受けて service へ渡す', () => {
    expect(ROUTE).toContain("c.req.query('uid')")
    expect(ROUTE).toContain("uidRaw === 'linked' || uidRaw === 'unlinked'")
  })

  it('service が uid をページ切り出しより先の全件絞り込みへ入れる', () => {
    // applyFilters の中で identityKeyKind を見る（ページ切り出しはその後）。
    const applyFilters = SERVICE.slice(
      SERVICE.indexOf('function applyFilters'),
      SERVICE.indexOf('function applyFilters') + 4000,
    )
    expect(applyFilters).toContain("opts.uid === 'linked'")
    expect(applyFilters).toContain("r.identityKeyKind === 'uid'")
    expect(applyFilters).toContain("opts.uid === 'unlinked'")
    expect(applyFilters).toContain("r.identityKeyKind !== 'uid'")
  })

  it('画面は uid を要求へ乗せ、絞り込み変更で1ページ目へ戻る', () => {
    expect(API).toContain("if (opts?.uid) p.set('uid', opts.uid)")
    expect(PAGE).toContain("uid: uid === 'linked' || uid === 'unlinked' ? uid : undefined")
    // 条件変更の監視に uid が入っている（= 変えたら page=1 へ戻る）。
    expect(PAGE).toContain('[debouncedQ, onlyDups, account, uid]')
  })
})

/**
 * FRIEND-10: CSV書き出しは共通の csvCell（先頭 = + - @ への ' 付け）を使い、
 * 表示中ページではなく条件に合う全件を対象にする。
 */
describe('FRIEND-10 統合ユーザーCSVは全件を共通部品で書き出す', () => {
  it('共通の csvCell を使う（独自の引用符だけの整形を残さない）', () => {
    expect(PAGE).toContain("import { csvCell } from '@/lib/presentation'")
    expect(PAGE).not.toContain('localCsvCell')
    expect(PAGE).toContain('.map(csvCell)')
  })

  it('表示中ページではなく全ページを取りにいく', () => {
    expect(PAGE).toContain('all.push(...res.data.rows)')
    // 1回の応答上限で順に取り、件数分集まるまで続ける。
    expect(PAGE).toContain('pageSize: 200')
    expect(PAGE).toContain('all.length < exportTotal')
    // 安全弁（無限に追い続けない上限）。
    expect(PAGE).toContain('p <= 500')
  })

  it('UTF-8 BOM を付け、成否どちらでも exporting を戻す', () => {
    expect(PAGE).toContain('\\uFEFF')
    expect(PAGE).toContain('} catch {')
    expect(PAGE).toContain('setExporting(false)')
    expect(PAGE).toContain('CSVを書き出せませんでした')
  })
})
