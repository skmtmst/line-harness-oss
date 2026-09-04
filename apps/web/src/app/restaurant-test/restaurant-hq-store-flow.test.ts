import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const stores = readFileSync(new URL('./stores/store-list.tsx', import.meta.url), 'utf8')
const wizard = readFileSync(new URL('./stores/new/page.tsx', import.meta.url), 'utf8')
const banner = readFileSync(new URL('./stores/store-context-banner.tsx', import.meta.url), 'utf8')
const index = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const storesPage = readFileSync(new URL('./stores/page.tsx', import.meta.url), 'utf8')
const accountsPage = readFileSync(new URL('../accounts/page.tsx', import.meta.url), 'utf8')
const accountsNewPage = readFileSync(new URL('../accounts/new/page.tsx', import.meta.url), 'utf8')
const consolePage = readFileSync(new URL('./restaurant-console.tsx', import.meta.url), 'utf8')
const api = readFileSync(new URL('../../lib/restaurant-test-api.ts', import.meta.url), 'utf8')
const manualLinks = readFileSync(new URL('../../lib/manual-links.ts', import.meta.url), 'utf8')

describe('飲食店向けHQと店舗追加動線', () => {
  it('店舗一覧と追加の重複入口を統括と店舗追加ウィザードへ転送する', () => {
    // D-3: 旧URLを消さず、店舗の一覧と追加の正本だけを1か所にする。
    expect(index).toContain("redirect('/hq')")
    expect(storesPage).toContain("redirect('/hq')")
    expect(stores).toContain("router.replace('/hq')")
    /*
      2026-09-04: `/accounts` と `/accounts/new` の転送はどちらもやめた。
      **統括の店舗管理と、LINE公式アカウントの設定は別のもの。**
      **店舗を作ることと、アカウントを登録することも別**（要件 §5-3）。
      店舗の入口はここで見張るが、`/accounts` は設計 ★V6 33-1 の一覧、
      `/accounts/new` は 33-2 の登録になった。
    */
    expect(accountsPage).not.toContain("redirect('/hq')")
    expect(accountsNewPage).not.toContain("redirect('/restaurant-test/stores/new')")
  })

  it('デモ作成UIと公開bootstrap呼出しを持たず、空組織を統括へ案内する', () => {
    expect(api).not.toContain('bootstrap:')
    expect(consolePage).not.toContain('restaurantTestApi.bootstrap')
    expect(consolePage).not.toContain('テスト領域を作成')
    expect(consolePage).toContain('統括から店舗を登録してください。')
  })

  it('URLへ店舗識別子を付けず、サーバーセッションAPIで切り替える', () => {
    expect(api).toContain('selectStore:')
    expect(api).toContain('clearStoreSelection:')
    expect(banner).toContain('を表示しています')
    expect(banner).toContain('統括に戻る')
    expect(banner).toContain("router.push('/hq')")
    expect(banner).not.toContain('?store=')
  })

  it('規約同意を先頭にした5ステップで、資格情報は2項目だけ入力する', () => {
    for (const label of [
      '利用規約への同意',
      '店舗の基本情報',
      'LINE公式アカウントを作る',
      'Messaging APIを有効にして接続する',
      '接続の確認',
      'まずはLINE公式アカウントの登録を行いましょう。',
      'アカウントセットアップ実行',
      'よくある質問',
    ]) expect(wizard).toContain(label)
    expect(wizard).toContain('ステップ {step} / 5')
    expect(wizard).toContain('チャネルID')
    expect(wizard).toContain('チャネルシークレット')
    expect(wizard).not.toContain('チャネルアクセストークン（長期）')
    expect(wizard).not.toContain('ベーシックIDを入力')
    expect(wizard).toContain('type="password"')
  })

  it('店舗未選択の新しい統括でも規約同意から店舗登録まで進める', () => {
    expect(api).toContain('withOptionalAccount')
    expect(wizard).toContain('restaurantTestApi.termsAgreement(selectedAccountId)')
    expect(wizard).not.toContain("if (!selectedAccountId) throw new Error")
    expect(wizard).not.toContain('disabled={!selectedAccountId || saving}')
    expect(wizard).toContain('統括の店舗一覧へ')
  })

  it('マニュアルURLをJSXへ直書きせず、空の間は非活性にする', () => {
    expect(wizard).toContain('MANUAL_LINKS')
    expect(wizard).toContain('マニュアルは準備中です')
    expect(manualLinks).toContain("createOfficialAccount: ''")
    expect(manualLinks).toContain("enableMessagingApi: ''")
    expect(manualLinks).toContain("findChannelCredentials: ''")
  })

  it('店舗ごとに別のLINEプロバイダーを作る理由を利用者向けに案内する', () => {
    expect(wizard).toContain('店舗ごとに、新しいプロバイダーを作ってください。')
    expect(wizard).toContain('同じお客様を店舗ごとに別々に管理できなくなります。')
    expect(wizard).not.toContain('一意制約')
  })
})
