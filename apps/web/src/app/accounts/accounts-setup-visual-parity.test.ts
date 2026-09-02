import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const directory = dirname(fileURLToPath(import.meta.url))
const setupSource = readFileSync(join(directory, 'new/page.tsx'), 'utf8')
const accountsSource = readFileSync(join(directory, 'page.tsx'), 'utf8')
const wizardSource = readFileSync(join(directory, '../restaurant-test/stores/new/page.tsx'), 'utf8')
const orderingSource = readFileSync(join(directory, '../../components/accounts/account-ordering.tsx'), 'utf8')
const switcherSource = readFileSync(join(directory, '../../components/accounts/account-switcher.tsx'), 'utf8')
const editModalSource = readFileSync(join(directory, '../../components/accounts/account-edit-modal.tsx'), 'utf8')

describe('D-3 店舗追加・一覧の統括集約', () => {
  it('旧アカウントURLを消さず、一覧と追加の正本へ転送する', () => {
    // 既存ブックマークを壊さず、同じ操作ができる入口を1つに限定する。
    expect(accountsSource).toContain("redirect('/hq')")
    expect(setupSource).toContain("redirect('/restaurant-test/stores/new')")
  })

  it('追加先の店舗ウィザードは利用規約を先頭にした5ステップを維持する', () => {
    for (const label of [
      '利用規約への同意',
      '店舗の基本情報',
      'LINE公式アカウントを作る',
      'Messaging APIを有効にして接続する',
      '接続の確認',
    ]) {
      expect(wizardSource).toContain(label)
    }
    expect(wizardSource).toContain('ステップ {step} / 5')
    expect(wizardSource).toContain('type="password"')
  })

  it('旧画面から外した階層編集部品はデータ削除をせず残す', () => {
    for (const label of ['未設定のLINEアカウント', 'LINEアカウント階層をドラッグ＆ドロップで編集', '未保存の変更', '構成を保存']) {
      expect(orderingSource).toContain(label)
    }
    expect(orderingSource).toContain('api.lineAccounts.updateHierarchy')
    expect(accountsSource).not.toContain('<AccountOrdering />')
  })

  it('共通アカウント切替部品は確認後に管理対象を切り替える', () => {
    for (const label of ['現在のLINEアカウント', '表示中', 'このアカウントへ移動しますか？', 'このアカウントへ移動']) {
      expect(switcherSource).toContain(label)
    }
    expect(switcherSource).toContain('setSelectedAccountId(target.id)')
    expect(switcherSource).toContain("window.location.assign('/')")
  })

  it('再利用する編集モーダルは秘密値を読まず、狭い画面でも入力欄を切らない', () => {
    expect(editModalSource).toContain('Edit modal never reads persisted credential values')
    expect(editModalSource).not.toContain('sm:items-center')
    expect(editModalSource).toContain('sticky top-0')
    expect(editModalSource).toContain('grid grid-cols-1 gap-3 sm:grid-cols-2')
  })
})
