import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 顧客へのお知らせ（★V6 `festr` / `Q55bb`）の寸法の見張り。
 *
 * **`Q55bb`（お知らせの中身を編集する）は、現行設定で安全に出せる範囲だけ描く。**
 * 版を分けて公開する口（下書き版・公開版・テスト受信者）が無いため、
 * 「下書き保存」「公開」は出さない。現行の `updateSetting` で扱える入力と、
 * きっかけ・差込項目・プレビューの確認構造だけを設計へ寄せる。
 * 引き継ぎは `docs/design-qa/v6-photo-notify-automation-handoff.md`。
 */

const HERE = import.meta.dirname
/** リポジトリの根。`apps/web/src/app/line-notifications` から5つ上。 */
const REPO = join(HERE, '..', '..', '..', '..', '..')
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const CSS = readFileSync(join(HERE, 'customer-notifications.module.css'), 'utf8')

describe('V6 顧客へのお知らせの寸法', () => {
  it('種類の絞り込みは 高さ40 / 角丸8 / 13px / 700', () => {
    expect(CSS).toMatch(/\.category\s*\{[^}]*height: 40px;/)
    expect(CSS).toMatch(/\.category\s*\{[^}]*border-radius: var\(--radius-control\);/)
    expect(CSS).toMatch(/\.category\s*\{[^}]*font-size: var\(--text-label\);/)
    expect(CSS).toMatch(/\.category\s*\{[^}]*font-weight: 700;/)
    expect(PAGE).toContain('className={`${styles.category}')
    // Tailwind直書きの帯へ戻さない。
    expect(PAGE).not.toContain('rounded-control px-3 py-2.5 text-left text-sm')
  })

  it('主要ボタンは 高さ40 / 角丸8 / 余白[0,14] / 13px / 700', () => {
    expect(CSS).toMatch(/\.action\s*\{[^}]*height: 40px;/)
    expect(CSS).toMatch(/\.action\s*\{[^}]*border-radius: var\(--radius-control\);/)
    expect(CSS).toMatch(/\.action\s*\{[^}]*padding: 0 14px;/)
    expect(CSS).toMatch(/\.action\s*\{[^}]*font-size: var\(--text-label\);/)
    expect(CSS).toMatch(/\.action\s*\{[^}]*font-weight: 700;/)
    expect(PAGE).toContain('${styles.action} ${styles.actionPrimary}')
    expect(PAGE).toContain('${styles.action} ${styles.actionSecondary}')
    // 直書きの主要ボタンへ戻さない。
    expect(PAGE).not.toContain('bg-accent text-on-accent rounded-control px-5 py-2.5')
  })

  it('行の中の小さな操作は 高さ32 / 角丸6', () => {
    expect(CSS).toMatch(/line-notification-v6-row-action\)\s*\{[^}]*height: 32px;/)
    expect(CSS).toMatch(/line-notification-v6-row-action\)\s*\{[^}]*border-radius: var\(--radius-mini\);/)
    expect(PAGE).toContain('className="line-notification-v6-row-action"')
  })

  it('カードは r10', () => {
    // `--radius-card` は 10px 1本になった（以前は tile 10 と card 12 の2つ）。
    // 値そのものは design-token-contract.test.ts が固定している。
    expect(PAGE).toContain('rounded-card')
  })

  it('一覧は設計どおり1ページ6件に区切り、件数とページ送りを同じ場所に出す', () => {
    expect(PAGE).toContain('const CUSTOMER_PAGE_SIZE = 6')
    expect(PAGE).toContain('const visiblePage = visible.slice(')
    expect(PAGE).toContain('<Pagination page={customerPage}')
    expect(PAGE).toContain('お知らせの種類 {settings.length}つのうち {visiblePage.length}つを表示')
  })

  it('タブ帯は共通部品（高さ44）を使う', () => {
    expect(PAGE).toContain("import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'")
    const tabs = readFileSync(
      join(REPO, 'apps', 'web', 'src', 'components', 'shared', 'tabs.module.css'),
      'utf8',
    )
    expect(tabs).toContain('height: 44px;')
  })

  it('編集は専用レイアウトへ切り替えるが、版APIが無いうちは公開操作を作らない', () => {
    expect(existsSync(join(HERE, 'customer'))).toBe(false)
    expect(PAGE).toContain('function CustomerNotificationEditor')
    expect(PAGE).toContain('data-design-node="Q55bb"')
    expect(PAGE).toContain('いつ送りますか')
    expect(PAGE).toContain('このお知らせで差し込める項目（EC連携から来ます）')
    expect(PAGE).toContain('取引メールと対応済み記録は、送信台帳の接続後に設定できます。')
    expect(PAGE).not.toContain('公開する')
    expect(PAGE).not.toContain('下書きを保存')
    // 引き継ぎが消えたら、作らない理由も消える。
    const handoff = join(REPO, 'docs', 'design-qa', 'v6-photo-notify-automation-handoff.md')
    expect(existsSync(handoff)).toBe(true)
    expect(readFileSync(handoff, 'utf8')).toContain('Q55bb')
  })
})
