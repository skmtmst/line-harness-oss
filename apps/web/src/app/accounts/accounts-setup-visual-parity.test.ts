import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const directory = dirname(fileURLToPath(import.meta.url))
const setupSource = readFileSync(join(directory, 'new/page.tsx'), 'utf8')
const hierarchySource = readFileSync(join(directory, 'account-hierarchy.tsx'), 'utf8')
const accountsSource = readFileSync(join(directory, 'page.tsx'), 'utf8')
const switcherSource = readFileSync(join(directory, '../../components/accounts/account-switcher.tsx'), 'utf8')
const editModalSource = readFileSync(join(directory, '../../components/accounts/account-edit-modal.tsx'), 'utf8')

describe('V2 10-1 Pen準拠のアカウントUI', () => {
  it('追加画面を公式アカウント作成から始まる6ステップの3カラム構成にする', () => {
    expect(setupSource).toContain("xl:grid-cols-[265px_minmax(0,1fr)_290px]")
    for (const label of ['設定の進み具合', 'このステップの完了条件', 'アカウント追加まで', '設定に迷ったとき']) {
      expect(setupSource).toContain(label)
    }
    expect(setupSource).toContain('すべての接続確認が完了するまでアカウントは追加されません')
    expect(setupSource).toContain('disabled={!allVerified || saving}')
    expect(setupSource).toContain('LINE公式アカウントを作成する')
    expect(setupSource).toContain('公式アカウントの作成・確認を完了してください')
    expect(setupSource.indexOf("'LINE公式アカウントを作成'")).toBeLessThan(setupSource.indexOf("'所属店舗・アカウント情報'"))
    expect(setupSource).toContain('completedCount * (100 / 6)')
  })

  it('Penと同じアウトライン鍵と用途別の配色を使う', () => {
    expect(setupSource).toContain('function LockIcon')
    expect(setupSource).not.toContain('🔒')
    expect(setupSource).toContain('bg-accent px-5 py-2.5')
    expect(setupSource).toContain('bg-accent p-4 text-on-accent')
    expect(setupSource).toContain('bg-canvas-sunken px-4 py-3 text-sm text-ink')
    expect(setupSource).toContain('bg-info-bg p-4')
    expect(setupSource).toContain('text-action')
    expect(setupSource).not.toContain('bg-action px-5 py-2.5')
  })

  it('LINE LoginとLIFFの設定場所へ直接進める', () => {
    expect(setupSource).toContain('LINE Developersを開く')
    expect(setupSource).toContain('対象画面を開く')
    expect(setupSource).toContain('LINE Login公式ガイド')
    expect(setupSource).toContain('LIFF設定を先に確認')
    expect(setupSource).toContain('Callback URL')
    expect(setupSource).toContain('LIFF Endpoint URL')
  })

  it('構成画面を未設定一覧と3階層のドロップ編集にする', () => {
    for (const label of ['未設定のLINEアカウント', 'LINEアカウント階層をドラッグ＆ドロップで編集', '未保存の変更', '構成を保存']) {
      expect(hierarchySource).toContain(label)
    }
    expect(hierarchySource).toContain('親・子・孫はすべてLINE公式アカウントです')
    expect(hierarchySource).toContain('api.lineAccounts.updateHierarchy')
  })

  it('空の構成にも確実にドラッグ元を渡して親候補として表示する', () => {
    expect(hierarchySource).toContain("event.dataTransfer.setData(ACCOUNT_DRAG_TYPE, accountId)")
    expect(hierarchySource).toContain("event.dataTransfer.getData(ACCOUNT_DRAG_TYPE)")
    expect(hierarchySource).toContain('draggedIdRef.current')
    expect(hierarchySource).toContain('draftRootIds.has(account.id)')
    expect(hierarchySource).toContain('data-hierarchy-root-drop')
    expect(hierarchySource).toContain('dropOn(event, null)')
  })

  it('現在表示中のLINEアカウントを示し、確認後に管理対象を切り替える', () => {
    for (const label of ['現在のLINEアカウント', '表示中', 'このアカウントへ移動しますか？', 'このアカウントへ移動']) {
      expect(switcherSource).toContain(label)
    }
    expect(switcherSource).toContain('setSelectedAccountId(target.id)')
    expect(switcherSource).toContain("window.location.assign('/')")
    expect(accountsSource).toContain('account.id === selectedAccountId')
  })

  it('LINE APIで自動判定した月額プランを一覧とCSVに表示する', () => {
    expect(accountsSource).toContain("account.plan?.label ?? '取得できません'")
    expect(accountsSource).toContain('LINE APIの当月送信上限')
    expect(accountsSource).toContain("['アカウント名', 'LINE ID', 'プラン', '友だち', 'Webhook', '状態']")
  })

  it('編集モーダルを画面上端から表示し、狭い画面でも入力欄を切らない', () => {
    expect(editModalSource).not.toContain('sm:items-center')
    expect(editModalSource).toContain('sticky top-0')
    expect(editModalSource).toContain('grid grid-cols-1 gap-3 sm:grid-cols-2')
  })
})
