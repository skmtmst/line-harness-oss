import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 顧客へのお知らせ（★V6 `festr` / `Q55bb`）の寸法の見張り。
 *
 * **`Q55bb`（お知らせの中身を編集する）は、公開版と下書き版を分ける。**
 * 公開済みの版を直接書き換えず、下書き保存と公開を別操作にする。
 */

const HERE = import.meta.dirname
/** リポジトリの根。`apps/web/src/app/line-notifications` から5つ上。 */
const REPO = join(HERE, '..', '..', '..', '..', '..')
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const CSS = readFileSync(join(HERE, 'customer-notifications.module.css'), 'utf8')

/**
 * 注釈を落とした page.tsx。「なぜ消したか」を書いた文が、消したはずの
 * 字面（例:「自分にテスト送信」）に当たるのを避ける
 * （notification-event-words-contract.test.ts と同じやり方）。
 */
const CODE = PAGE
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

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
    expect(PAGE).toContain('<Button variant="primary" onClick={onPublish}')
    expect(PAGE).toContain('<Button onClick={onTestSend}')
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
    expect(PAGE).toContain('<ListPagination')
    // #667: 件数表記は「Nつ中 X〜Yつを表示」の1形式へ統一。
    expect(PAGE).toContain('total={visible.length}')
    expect(PAGE).toContain('unit="つ"')
  })

  it('タブ帯は共通部品（高さ44）を使う', () => {
    expect(PAGE).toContain("import MergedTabs, { useMergedTab } from '@/components/layout/merged-tabs'")
    const tabs = readFileSync(
      join(REPO, 'apps', 'web', 'src', 'components', 'shared', 'tabs.module.css'),
      'utf8',
    )
    expect(tabs).toContain('height: 44px;')
  })

  it('編集は専用レイアウトへ切り替え、下書き保存と公開を分ける', () => {
    expect(existsSync(join(HERE, 'customer'))).toBe(false)
    expect(PAGE).toContain('function CustomerNotificationEditor')
    expect(PAGE).toContain('data-design-node="Q55bb"')
    expect(PAGE).toContain('いつ送りますか')
    expect(PAGE).toContain('このお知らせで差し込める項目（EC連携から来ます）')
    expect(PAGE).toContain('取引メールと対応済み記録は、送信台帳の接続後に設定できます。')
    expect(PAGE).toContain('下書きを保存')
    expect(PAGE).toContain('顧客へのお知らせを公開')
    expect(PAGE).toContain('公開中の内容は変わりません')
  })

  it('編集画面でもテスト送信の結果を操作の直後に表示する', () => {
    expect(PAGE).toContain("notice: { tone: 'success' | 'error'; text: string } | null")
    expect(PAGE).toContain('notice={notice}')
    expect(PAGE).toContain('テスト受信者 ${result.data.sent}名へ送信しました。')
  })

  it('EC通知の既定設定も選択中のLINEアカウントに限定して読み書きする', () => {
    expect(PAGE).toContain('api.ecCommerce.settings(selectedAccountId)')
    // N-330 (#943): 書き込みの正本は顧客通知定義。従来設定だけの行は定義を
    // 1回だけ作り、旧設定APIへの二重書き込みはしない。
    expect(PAGE).toContain('await args.api.createDefinition({')
    expect(PAGE).toContain('lineAccountId: args.accountId')
    expect(PAGE).not.toContain('args.api.updateSetting(')
    expect(PAGE).not.toContain('api.ecCommerce.updateSetting')
    expect(PAGE).toContain('const accountId = selectedAccountId')
  })

  it('保存・公開の応答は、返った時点のアカウント世代でしか画面へ書かない', () => {
    expect(PAGE).toContain('function isStale(guard: CustomerMutationGuard): boolean')
    expect(PAGE).toContain('currentGeneration: () => loadGeneration.current')
    expect(PAGE).toContain("if (outcome.kind === 'stale' || generation !== loadGeneration.current) return")
  })

  it('load()の再開点も、世代だけでなく選択中accountを見る（4経路で形をそろえる）', () => {
    // 保存・公開・テスト送信と同じ形。世代だけでは、切替の描画コミット後・
    // 次のload()発火前の隙間で前アカウントの一覧応答を見分けられない。
    expect(PAGE).toContain('const stale = () => generation !== loadGeneration.current || selectedAccountId !== selectedAccountRef.current')
    // load() の再開点が世代だけの照合へ戻っていないこと。
    expect(PAGE).not.toContain('if (generation !== loadGeneration.current) return')
  })

  it('テスト送信の完了判定も、保存・公開と同じ見張り（世代とアカウント）を通す', () => {
    // testSend だけ loadGeneration しか見ていないと、A→Bの描画コミット後・
    // Bのload()発火前に返った旧Aの結果がBの画面へ入りうる。
    expect(PAGE).toContain('async function sendCustomerTestNotification(args: {')
    expect(PAGE).toContain('if (isStale(guard)) return { kind: \'stale\' }')
    expect(PAGE).toContain('const outcome = await sendCustomerTestNotification({')
    expect(PAGE).toContain("if (outcome.kind === 'stale') return")
  })

  it('世代の照合はuseEffectの発火待ちに頼らない。選択中accountを描画のたびに同期させたrefでも見る', () => {
    // loadGeneration は load() の useEffect の中でしか進まない。切替の描画コミットと
    // その発火の間には隙間があるため、世代だけでなく account の一致も独立して見る。
    expect(PAGE).toContain('const selectedAccountRef = useRef(selectedAccountId)')
    expect(PAGE).toContain('selectedAccountRef.current = selectedAccountId')
    expect(PAGE).toContain("guard.forAccountId !== guard.currentAccountId()")
    expect(PAGE).toContain('currentAccountId: () => selectedAccountRef.current')
    expect(PAGE).toContain("forAccountId: selectedAccountId ?? ''")
  })

  it('#988 NEXT-05: テスト送信は「テスト受信者に送信」と名付け、宛先を見せる確認を挟む', () => {
    expect(CODE).toContain('テスト受信者に送信')
    expect(CODE).not.toContain('自分にテスト送信')
    // 宛先は登録済みのテスト受信者。開いただけでは送らず、0人・失敗では送信不可。
    expect(CODE).toContain('api.accountSettings.getTestRecipients(accountId)')
    expect(CODE).toContain("onConfirm={testRecipients.state === 'ready' && testRecipients.items.length > 0 ? confirmTestSend : undefined}")
    expect(CODE).toContain('お客さま全員への一斉配信ではありません')
  })

  it('#988 NEXT-06: 条件説明はイベント別の文で、一斉配信と誤解する表現を置かない', () => {
    // 表示名を文へそのまま繋いだ壊れた結合へ戻さない。
    expect(CODE).not.toContain('setting.label}らすぐ')
    expect(CODE).not.toContain('setting.label}とき')
    expect(CODE).not.toContain('全員に送る')
    expect(CODE).not.toContain('送らない相手')
    // 宛先はその出来事に関わるお客さまだけ。
    expect(CODE).toContain('その注文のお客さまだけ')
    expect(CODE).toContain('その定期便のお客さまだけ')
    expect(CODE).toContain('注文が確定したとき')
    expect(CODE).toContain('定期便の決済に失敗したとき')
    // 見本は架空と明記し、実在の人物名を宛先のように見せない。
    expect(CODE).toContain('架空の注文による表示例')
    expect(CODE).not.toContain('高橋 直人')
  })

  it('#988 LAY-10拡張: つながる先はリンク色の p ではなく実リンク', () => {
    expect(CODE).toContain('<Link href="/ec-commerce"')
    expect(CODE).toContain('<Link href="/contents/vars"')
    expect(CODE).toContain('<Link href="/chats"')
    expect(CODE).toContain('<Link href="/nen-campaigns"')
    expect(CODE).toContain('<Link href="/webhooks"')
    expect(CODE).not.toContain('text-accent"><p>EC連携</p>')
  })

  it('端末の控えと未保存の印は、送った文面がそのまま画面に残っているときだけ片づける', () => {
    // 保存中も入力できる。押した時点の写しで「保存済み」にすると、足した分が消える。
    expect(PAGE).toContain('function customerDraftFingerprint(draft: CustomerEditorDraft): string')
    expect(PAGE).toContain('currentFingerprint: () => editFingerprintRef.current.get(setting.eventType)')
    expect(PAGE).toContain('return guard.currentFingerprint() === guard.sentFingerprint')
    expect(PAGE).toContain('if (outcome.settleDraft) {')
    // 1打ごとに指紋を進め、飛んでいる保存を古いものにする。
    expect(PAGE).toContain('editFingerprintRef.current.set(eventType, customerDraftFingerprint(draft))')
  })
})
