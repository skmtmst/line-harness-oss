import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const EDIT_PAGE = readFileSync(join(HERE, 'edit', 'page.tsx'), 'utf8')
const PUBLISHER = readFileSync(
  join(HERE, '..', '..', '..', '..', 'worker', 'src', 'lib', 'rich-menu-publisher.ts'),
  'utf8',
)
const TARGETING_DB = readFileSync(
  join(HERE, '..', '..', '..', '..', '..', 'packages', 'db', 'src', 'rich-menus.ts'),
  'utf8',
)

describe('V6リッチメニューの画面契約', () => {
  it('GO8RQどおり画面名は共通トップバーだけに置く', () => {
    expect(PAGE).toContain('data-design-node="GO8RQ"')
    expect(PAGE).not.toContain("import Header from '@/components/layout/header'")
    expect(PAGE).not.toContain('<Header')
    expect(PAGE).not.toContain('トーク画面の下に表示されるメニューを作ります。')
  })

  it('作る・足す操作を一覧の左、扱う操作を右に置く', () => {
    const bar = PAGE.slice(PAGE.indexOf('data-design="Bar"'), PAGE.indexOf('data-design="Saved"'))
    expect(bar.indexOf('メニューを作る')).toBeLessThan(bar.indexOf('メニュー名で検索'))
    expect(bar.indexOf('フォルダを追加')).toBeLessThan(bar.indexOf('メニュー名で検索'))
    expect(bar.indexOf('出す順番を変える')).toBeGreaterThan(bar.indexOf('表示件数'))
    expect(PAGE).not.toContain('準備中')
  })

  it('LINEアカウント切替前の応答を捨て、全件をページ送りでたどれる', () => {
    expect(PAGE).toContain('activeAccountRef.current !== accountId')
    expect(PAGE).toContain("import Pagination from '@/components/shared/pagination'")
    expect(PAGE).toContain('pageCount={pageCount}')
    expect(PAGE).toContain('const shownGroups = sorted.slice')
    expect(PAGE).not.toContain('「表示」を増やすと出ます')
  })

  it('一覧を取得できないときはメニュー数と出し分け数を0件と断定しない', () => {
    expect(PAGE).toContain("const groupKpiState = !selectedAccount?.id")
    expect(PAGE).toContain("const groupKpiReady = groupKpiState === 'ready'")
    expect(PAGE).toContain('data-group-kpi-state={groupKpiState}')
    expect(PAGE).toContain("groupKpiReady ? groups.length : '—'")
    expect(PAGE).toContain("groupKpiReady ? targetingCount : '—'")
    expect(PAGE).toContain('公開中 —・${groupKpiUnavailableText}')
    expect(PAGE).toContain("'一覧を取得できませんでした'")
  })

  it('GO8RQどおり実際に友だちへ出す優先順を既定表示にする', () => {
    expect(PAGE).toContain("useState<SortKey>('priority')")
    expect(PAGE).toContain('出す順番（自分で決めた順）')
    expect(PAGE).toContain('上にあるメニューが優先されます。')
    expect(PAGE).toContain('いちばん上の1つだけが表示されます。')
    expect(PAGE).toContain('priorityRankByGroup.get(g.id)')
    expect(TARGETING_DB).toContain('ORDER BY g.targeting_priority ASC, g.created_at ASC')
  })

  it('並び替えは見た目だけでなく実際の判定順を全件そろえる', () => {
    expect(PAGE).toContain('targetingPriority: item.priority')
    expect(PAGE).toContain('displayOrder: item.priority')
    expect(PAGE).toContain('moveTargetingGroup(groups, group.id')
    expect(PAGE).toContain('reordered.map((item) =>')
    expect(PAGE).not.toContain("setSortKey('manual')")
  })

  it('編集画面も一覧と同じ1番始まりの出す順番を案内する', () => {
    expect(EDIT_PAGE).toContain('出す順番')
    expect(EDIT_PAGE).toContain('一覧で上にあるメニューが優先されます。現在は')
    expect(EDIT_PAGE).toContain('{targetingPriority + 1}番目です。')
    expect(EDIT_PAGE).toContain('value={targetingPriority + 1}')
    expect(EDIT_PAGE).toContain("Math.max(0, (parseInt(e.target.value, 10) || 1) - 1)")
    expect(EDIT_PAGE).not.toContain('数が小さいほうが先に出ます。')
  })
})

describe('V6リッチメニューの公開安全契約', () => {
  it('全画像の準備後にaliasを切り替え、旧メニューは最後に削除する', () => {
    expect(PUBLISHER).toContain('全ページを作成し、全画像を upload する')
    expect(PUBLISHER).toContain('ここが完走するまで alias は触らない')
    expect(PUBLISHER).toContain('await line.upsertRichMenuAlias(')
    expect(PUBLISHER).toContain('公開切替がすべて終わってから旧メニューを削除する')
  })

  it('alias切替に失敗したら旧IDへ戻す', () => {
    expect(PUBLISHER).toContain('const rollbackPublish = async () =>')
    expect(PUBLISHER).toContain('await line.upsertRichMenuAlias(aliasId, page.lineRichMenuId)')
    expect(PUBLISHER).toContain('await cleanupNewMenus()')
  })
})
