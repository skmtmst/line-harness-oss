import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
// 「LINE上にあるメニュー」の取り込み画面は external-import.tsx（★V7・★V8 で共有）。
const PAGE = readFileSync(new URL('../../v8/rich-menus/list.tsx', import.meta.url), 'utf8')
  + readFileSync(new URL('external-import.tsx', import.meta.url), 'utf8')
const EDIT_PAGE = readFileSync(new URL('new/create-v8.tsx', import.meta.url), 'utf8')
const PUBLISHER = readFileSync(
  join(HERE, '..', '..', '..', '..', 'worker', 'src', 'lib', 'rich-menu-publisher.ts'),
  'utf8',
)
const TARGETING_DB = readFileSync(
  join(HERE, '..', '..', '..', '..', '..', 'packages', 'db', 'src', 'rich-menus.ts'),
  'utf8',
)

describe('V6リッチメニューの画面契約', () => {
  it('LINEアカウント切替前の応答を捨て、全件をページ送りでたどれる', () => {
    expect(PAGE).toContain('activeAccountRef.current !== accountId')
    expect(PAGE).toContain("import Pagination from '@/components/shared/pagination'")
    expect(PAGE).toContain('pageCount={pageCount}')
    expect(PAGE).toContain('api.richMenuGroups.listPage(accountId')
    expect(PAGE).toContain('setGroupTotal(groupsRes.data.total)')
    expect(PAGE).not.toContain('「表示」を増やすと出ます')
  })

  it('一覧を取得できないときはメニュー数と出し分け数を0件と断定しない', () => {
expect(PAGE).toContain("const groupKpiReady = groupKpiState === 'ready'")
    expect(PAGE).toContain('groupKpiReady ?')
    expect(PAGE).toContain('groupKpiUnavailableText')
  })

  it('一覧APIの月間タップ数とのべ人数を表示し、部分集計だと明記する', () => {
expect(PAGE).toContain('g.monthlyStats.taps')
    expect(PAGE).toContain('uniqueAudience')
    expect(PAGE).toContain('（記録開始後）')
  })

  it('LINEから読んだ面ごとの動きを取り込み前に表示する', () => {
    expect(PAGE).toContain('selected.areas.slice(0, 6)')
    expect(PAGE).toContain('externalActionText(area.action)')
    expect(PAGE).toContain('URLを開く（${action.url}）')
    expect(PAGE).toContain('メッセージを送る「${action.text}」')
    expect(PAGE).toContain('未対応の動き')
  })

  it('GO8RQどおり実際に友だちへ出す優先順を既定表示にする', () => {
expect(PAGE).toContain("sort: 'priority'")
    expect(PAGE).toContain('orderTargetingGroups')
  })

  it('並び替えは見た目だけでなく実際の判定順を全件そろえる', () => {
expect(PAGE).toContain('fullOrderedGroups')
    expect(PAGE).toContain('moveTargetingGroup(ordered, id')
    expect(PAGE).toContain('api.richMenuGroups.reorderPriorities(accountId, orderedIds)')
  })

  it('編集画面も一覧と同じ1番始まりの出す順番を案内する', () => {
expect(EDIT_PAGE).toContain('targetingPriority + 1')
    expect(EDIT_PAGE).toContain('順番が早いメニューが出ます')
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
    // E-08 #621 案Aで段階公開へ分割。補償は restorePreSwitchLive が担う。
    expect(PUBLISHER).toContain('export async function restorePreSwitchLive(')
    expect(PUBLISHER).toContain('await line.upsertRichMenuAlias(aliasId, old.lineRichMenuId)')
    expect(PUBLISHER).toContain('await deleteRichMenuShells(')
  })
})
