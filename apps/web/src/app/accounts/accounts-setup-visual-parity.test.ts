import { readFileSync as readOwnFile } from 'node:fs'
import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const directory = dirname(fileURLToPath(import.meta.url))
// ★V8 の登録は src/v8 に一から書いた（入口 new/page.tsx は @/v8 から読む）。新しい画面も一緒に読む。
const setupSource = readFileSync(join(directory, 'new/page.tsx'), 'utf8') + readFileSync(join(directory, '../../v8/account-new/register.tsx'), 'utf8')
const accountsSource = readFileSync(join(directory, '../../v8/settings/accounts/accounts.tsx'), 'utf8')
const wizardSource = readFileSync(join(directory, '../../v8/restaurant/store-new/store-new.tsx'), 'utf8')
const orderingSource = readFileSync(join(directory, '../../components/accounts/account-ordering.tsx'), 'utf8')
const editModalSource = readFileSync(join(directory, '../../components/accounts/account-edit-modal.tsx'), 'utf8')

describe('D-3 店舗追加・一覧の統括集約', () => {
  it('LINEアカウントの設定と登録は /accounts に置く（どこへも転送しない）', () => {
    /*
      2026-09-04: 転送を2つともやめた。**統括の店舗管理と、LINE公式アカウントの
      設定は別のもの**。**店舗を作ることと、アカウントを登録することも別**
      （要件 `管理画面-33-account-settings` §5-3）。
      `/hq` は統括向けの店舗管理として、店舗ウィザードは飲食店向けの入口として残す。
    */
    expect(accountsSource).not.toContain("redirect('/hq')")
    expect(accountsSource).toContain('boardId="V7vn3"')
    expect(setupSource).not.toContain("redirect('/restaurant-test/stores/new')")
    expect(setupSource).toContain('boardId={shownStep.node}')
  })

  it('新設計の4項目入力・自動接続と5つの正本ノードを使う', () => {
    /*
      2026-10-16: ⑤の進捗を「読むだけ（followerImportState）」から step の自己連鎖へ替えた。
      ソース文字で呼ぶ口と正本ノードを数えていた並びは、（新しいソース契約を増やさない）
      に合わせてやめ、ソースの字面ではなく実際の描画・呼び出しで確かめる試験へ移した。
        - 4項目入力・自動接続と呼ぶ口: `new/register-v8.react.test.tsx`
          （「②の4項目が空では③へ進めない」「登録後は画面から取り込みの続きを進め…」）
        - 5つの正本ノード: 同ファイル「各段と結果の窓は絵の正本ノードを描く」＋
          `scripts/visual-qa/v8-design-map-route-contract.test.ts`（ノードとURLの対応）
      ここには「置かないもの」だけを残す。
    */
    expect(setupSource).not.toContain('channel-access-token')
    expect(setupSource).not.toContain('id="liff-id"')
    expect(setupSource).not.toContain('account-timezone')
  })

  it('追加先の店舗ウィザードは利用規約を先頭にした5ステップを維持する', () => {
    for (const label of [
      '利用規約への同意',
      '店舗の基本情報',
      'LINE公式アカウントを作る',
      'Messaging APIで接続',
      '接続の確認',
    ]) {
      expect(wizardSource).toContain(label)
    }
    expect(wizardSource).toContain('ステップ ${step} / 5')
    expect(wizardSource).toContain('type="password"')
  })

  it('階層編集部品は残すが、板に無いので一覧からは開かない', () => {
    // R191: 移動先メニュー（キーボード・クリックの代替経路）が増えたので、
    // 見出しは「ドラッグ＆ドロップで編集」とは言わず「編集」に留める。
    for (const label of ['未設定のLINEアカウント', 'LINEアカウント階層を編集', '未保存の変更', '構成を保存する']) {
      expect(orderingSource).toContain(label)
    }
    expect(orderingSource).toContain('api.lineAccounts.updateHierarchy')
    /*
      板  に並び順の操作は無いので、管理画面 の一覧（page.tsx 自身）からは外した。
      部品自体は残し、絵に無い塊を一覧に出さない。
    */
    expect(readOwnFile(join(directory, 'page.tsx'), 'utf8')).not.toContain('AccountOrdering')
    /*
      ★V8 の一覧（src/v8/settings/accounts、#1557）は頭の「並び順と親子を変える」で窓を開き、
      その窓の中だけで並び替えの部品を出す。一覧の本体に塊として並べない。
    */
    const v8ListSource = readOwnFile(join(directory, '../../v8/settings/accounts/accounts.tsx'), 'utf8')
    expect(v8ListSource.match(/<AccountOrdering\b/g) ?? []).toHaveLength(1)
    expect(v8ListSource).toMatch(/\{orderingOpen \? <AccountOrdering\s+[\s\S]*?onClose=\{[\s\S]*?onSaved=\{[\s\S]*?\/> : null\}/)
    expect(orderingSource).toContain('designNode="a7lUk"')
  })

  it('再利用する編集モーダルは秘密値を読まず、狭い画面でも入力欄を切らない', () => {
    expect(editModalSource).toContain('Edit modal never reads persisted credential values')
    // 相対import先の別部品でなく、このモーダルの外枠を調べる。
    const modalOverlay = editModalSource.match(/className="fixed inset-0[^\"]*"/)?.[0]
    expect(modalOverlay).toContain('items-start')
    expect(modalOverlay).toContain('overflow-y-auto')
    expect(modalOverlay).not.toContain('sm:items-center')
    expect(editModalSource).toContain('sticky top-0')
    expect(editModalSource).toContain('grid grid-cols-1 gap-3 sm:grid-cols-2')
  })
})
