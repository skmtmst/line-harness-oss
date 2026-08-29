import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8')
const WORKER = readFileSync(new URL('../../../../worker/src/routes/contents.ts', import.meta.url), 'utf8')

describe('V6 登録メディア一覧の契約', () => {
  it('V6の実Nodeと共通状態部品を使う', () => {
    expect(PAGE).toContain('data-design-node="g89Tc"')
    expect(PAGE).toContain('<ListState kind="loading"')
    expect(PAGE).toContain('kind="error"')
    expect(PAGE).toContain('kind="empty"')
  })

  it('本文に画面タイトルと準備中のマニュアルを重ねない', () => {
    expect(PAGE).not.toContain("import Header from")
    expect(PAGE).not.toContain('マニュアルは準備中です')
  })

  it('未取得の使用数を0件に見せない', () => {
    expect(PAGE).toContain("? '使用先を確認できません'")
    expect(PAGE).toContain("item.usageCount === 0")
    expect(PAGE).toContain("? 'どこでも使っていない'")
    expect(PAGE).toContain('`${item.usageCount}か所で使用中`')
  })

  it('使っていないメディアだけを一覧で絞り込める', () => {
    expect(PAGE).toContain("import FilterChip from '@/components/shared/filter-chip'")
    expect(PAGE).toContain('selected={showUnusedOnly}')
    expect(PAGE).toContain('!showUnusedOnly || item.usageCount === 0')
    expect(PAGE).toContain('使っていない')
  })

  it('既存の寸法・長さ・容量をカードへ出し、作り物の値で埋めない', () => {
    expect(PAGE).toContain('item.width != null && item.height != null')
    expect(PAGE).toContain('item.durationMs != null')
    expect(PAGE).toContain('formatSize(item.sizeBytes)')
    expect(PAGE).not.toContain("details.push('—')")
  })

  it('並び順と表示件数を選べる', () => {
    expect(PAGE).toContain("const [sort, setSort] = useState<MediaSort>('newest')")
    expect(PAGE).toContain('入れた日が新しい順')
    expect(PAGE).toContain('使われている順')
    expect(PAGE).toContain('right.usageCount == null')
    expect(PAGE).toContain('const [pageSize, setPageSize] = useState(20)')
    expect(PAGE).toContain('PAGE_SIZE_OPTIONS')
    expect(PAGE).toContain('filtered.slice((page - 1) * pageSize, page * pageSize)')
  })

  it('使用中メディアの強制削除口を持たない', () => {
    expect(PAGE).not.toContain('force: true')
    expect(PAGE).toContain('使用先から外すまで削除できません')
    expect(API).not.toContain("`/api/media/${id}${opts?.force ? '?force=1' : ''}`")
  })

  it('選択中のLINEアカウントを一覧・登録・変更・使用先・削除へ渡す', () => {
    expect(PAGE).toContain('api.media.list(accountAtRequest)')
    expect(PAGE).toContain('latestAccountRef.current')
    expect(API).toContain("q.set('accountId', accountId)")
    expect(WORKER).toContain("c.req.query('accountId')")
    expect(WORKER).toContain('canAccessAllLineAccounts')
  })

  it('ブラウザ申告だけでなく実ファイル形式を確認する', () => {
    expect(WORKER).toContain('hasMediaSignature(bytes, mimeType)')
    expect(WORKER).toContain('media orphan cleanup failed')
  })
})
