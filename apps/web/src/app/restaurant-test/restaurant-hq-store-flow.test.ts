import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const stores = readFileSync(new URL('./stores/store-list.tsx', import.meta.url), 'utf8')
const wizard = readFileSync(new URL('./stores/new/page.tsx', import.meta.url), 'utf8')
const banner = readFileSync(new URL('./stores/store-context-banner.tsx', import.meta.url), 'utf8')
const index = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const api = readFileSync(new URL('../../lib/restaurant-test-api.ts', import.meta.url), 'utf8')
const manualLinks = readFileSync(new URL('../../lib/manual-links.ts', import.meta.url), 'utf8')

describe('飲食店向けHQと店舗追加動線', () => {
  it('飲食店向け入口を常に店舗一覧へ向ける', () => {
    expect(index).toContain("redirect('/restaurant-test/stores')")
    expect(stores).toContain('店舗一覧')
    expect(stores).toContain('アーカイブ済みも表示')
    expect(stores).toContain('friend_count == null')
    expect(stores).toContain("router.push('/restaurant-test/dashboard')")
  })

  it('URLへ店舗識別子を付けず、サーバーセッションAPIで切り替える', () => {
    expect(api).toContain('selectStore:')
    expect(api).toContain('clearStoreSelection:')
    expect(banner).toContain('を表示しています')
    expect(banner).toContain('統括に戻る')
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
