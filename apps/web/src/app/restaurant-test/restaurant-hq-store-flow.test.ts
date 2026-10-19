import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 旧一覧の転送の部品（stores/store-list.tsx）はどこからも読まれないので 2026-10-07 に消した。転送は stores/page.tsx の redirect が担う。
const wizard = readFileSync(new URL('../../v8/restaurant/store-new/store-new.tsx', import.meta.url), 'utf8')
const terms = readFileSync(new URL('../../v8/restaurant/terms/terms.tsx', import.meta.url), 'utf8')
const menu = readFileSync(new URL('../../components/hq/account-menu.tsx', import.meta.url), 'utf8')
const index = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const storesPage = readFileSync(new URL('./stores/page.tsx', import.meta.url), 'utf8')
const accountsPage = readFileSync(new URL('../accounts/page.tsx', import.meta.url), 'utf8')
const accountsNewPage = readFileSync(new URL('../accounts/new/page.tsx', import.meta.url), 'utf8')
const consolePage = readFileSync(new URL('../../v8/restaurant/booking-kit/shell.tsx', import.meta.url), 'utf8')
const api = readFileSync(new URL('../../lib/restaurant-test-api.ts', import.meta.url), 'utf8')

describe('飲食店向けHQと店舗追加動線', () => {
  it('店舗一覧と追加の重複入口を統括と店舗追加ウィザードへ転送する', () => {
    // D-3: 旧URLを消さず、店舗の一覧と追加の正本だけを1か所にする。
    expect(index).toContain("redirect('/hq')")
    expect(storesPage).toContain("redirect('/hq')")
    /*
      2026-09-04: `/accounts` と `/accounts/new` の転送はどちらもやめた。
      **統括の店舗管理と、LINE公式アカウントの設定は別のもの。**
      **店舗を作ることと、アカウントを登録することも別**（要件 §5-3）。
      店舗の入口はここで見張るが、`/accounts` は設計 ★管理画面 33-1 の一覧、
      `/accounts/new` は 33-2 の登録になった。
    */
    expect(accountsPage).not.toContain("redirect('/hq')")
    expect(accountsNewPage).not.toContain("redirect('/restaurant-test/stores/new')")
  })

  it('デモ作成UIと公開bootstrap呼出しを持たず、空組織を統括へ案内する', () => {
    expect(api).not.toContain('bootstrap:')
    expect(consolePage).not.toContain('restaurantTestApi.bootstrap')
    expect(consolePage).not.toContain('テスト領域を作る')
    expect(consolePage).toContain('統括から店舗を登録してください。')
  })

  it('URLへ店舗識別子を付けず、サーバーセッションAPIで切り替える', () => {
    expect(api).toContain('selectStore:')
    expect(api).toContain('clearStoreSelection:')
    expect(menu).toContain('統括に戻る')
    expect(menu).toContain('restaurantTestApi.clearStoreSelection(selectedAccountId)')
    expect(menu).toContain("router.push('/hq')")
    expect(menu).not.toContain('?store=')
  })

  it('規約同意を先頭にした5ステップで、資格情報は2項目だけ入力する', () => {
    for (const label of [
      '利用規約への同意',
      '店舗の基本情報',
      'LINE公式アカウントを作る',
      'Messaging APIで接続',
      '接続の確認',
      'まずはLINE公式アカウントの登録を行いましょう。',
      'アカウントセットアップ実行',
      'よくある質問',
    ]) expect(wizard).toContain(label)
    expect(wizard).toContain('ステップ ${step} / 5')
    expect(wizard).toContain('チャネルID')
    expect(wizard).toContain('チャネルシークレット')
    expect(wizard).not.toContain('チャネルアクセストークン（長期）')
    expect(wizard).not.toContain('ベーシックIDを入力')
    expect(wizard).toContain('type="password"')
  })

  it('店舗追加と利用規約の画面名はトップバーだけに置き、戻る導線は本文に残す', () => {
    expect(wizard).toContain("usePageTitle('店舗を追加')")
    expect(terms).toContain("usePageTitle('利用規約')")
    expect(wizard).toContain("<Button href=\"/hq\">キャンセル</Button>")
    expect(terms).toContain("label: '店舗を追加', href: '/restaurant-test/stores/new'")
    expect(wizard).not.toContain("@/components/layout/header")
    expect(terms).not.toContain("@/components/layout/header")
    expect(wizard).not.toContain('<Header')
    expect(terms).not.toContain('<Header')
  })

  it('店舗未選択の新しい統括でも規約同意から店舗登録まで進める', () => {
    expect(api).toContain('withOptionalAccount')
    expect(wizard).toContain('restaurantTestApi.termsAgreement(selectedAccountId)')
    expect(wizard).not.toContain("if (!selectedAccountId) throw new Error")
    expect(wizard).not.toContain('disabled={!selectedAccountId || saving}')
    expect(wizard).toContain('統括の店舗一覧へ')
  })

  it('店舗ごとに別のLINEプロバイダーを作る理由を利用者向けに案内する', () => {
    expect(wizard).toContain('店舗ごとに、新しいプロバイダーを作ってください。')
    expect(wizard).toContain('同じお客様を店舗ごとに別々に管理できなくなります。')
    expect(wizard).not.toContain('一意制約')
  })
})
