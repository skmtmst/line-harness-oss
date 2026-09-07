import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')

describe('機能設定の添付デザイン', () => {
  it('見出し操作と必須・通常スイッチの表示を保つ', () => {
    expect(source).not.toContain('適用先：この契約全体')
    expect(source).toContain('並びを変える')
    expect(source).toContain('初期値に戻す')
    expect(source).toContain('機能設定を保存')
    expect(source).toContain('まとめて切替')
    expect(source).toContain('上へ移動')
    expect(source).toContain('下へ移動')
    expect(source).toContain('function LockIcon()')
    expect(source).toContain('item.required && <span')
    expect(source).toContain('disabled={item.required}')
    expect(source).toContain('absolute left-0.5 top-0.5')
  })

  it('並べ替えは項目ごとで、区分をまたがない', () => {
    // 点は「この行は並べ替えの対象」という印。
    expect(source).toContain('function GripIcon()')
    // ↑↓ は行に付く。区分の見出しには付けない。
    expect(source).toContain('aria-label={`${item.label}を上へ`}')
    expect(source).toContain('aria-label={`${item.label}を下へ`}')
    expect(source).not.toContain('aria-label={`${group.label}を上へ`}')
    // 端では押せない。
    expect(source).toContain('canMoveUp={index > 0}')
    expect(source).toContain('canMoveDown={index < group.items.length - 1}')
    // 保存は区分ごとの並びとして送る。
    expect(source).toContain('sidebarItemOrder: currentOrder')
  })

  it('取得した版で一括保存し、409では最新を読み直して編集中身を残す', () => {
    expect(source).toContain('setSettingsVersion(response.data.version ?? 0)')
    expect(source).toContain('expectedVersion: settingsVersion')
    expect(source).toContain('error instanceof ApiError && error.status === 409')
    expect(source).toContain('const latest = await api.featureSettings.get(selectedAccountId)')
    expect(source).toContain('最新の状態を読み直したので、内容を確認してもう一度保存してください。')
  })

  it('クリックできる操作は指、無効な操作は禁止カーソルで統一する', () => {
    expect(source).toContain("total === 0 ? 'cursor-default' : 'cursor-pointer'")
    expect(source).toContain('h-7 w-7 cursor-pointer')
    expect(source).toContain('min-h-10 cursor-pointer rounded-lg')
    expect(source).toContain('min-h-10 cursor-pointer items-center')
    expect(source).toContain('disabled:cursor-not-allowed')
  })

  it('サイドメニューの見え方は、左で決めた並びをそのまま出す', () => {
    expect(source).toContain('この印はメニューに表示されません')
    expect(source).toContain('項目が非表示になります')
    // 別に並べ直さない。保存前と保存後で姿が変わらないようにする。
    expect(source).toContain('ordering && <SidebarPreview groups={groups} features={features} />')
    expect(source).not.toContain('PREVIEW_SECTIONS')
    expect(source).not.toContain('サイドメニューの見え方</h2>')
    expect(source).not.toContain('保存前</span>')
  })

  it('通常表示は設計どおり3列に分け、使っている数を分析APIから出す', () => {
    expect(source).toContain("['basic', 'delivery', 'contents']")
    expect(source).toContain("['results', 'automation', 'booking', 'specialized']")
    expect(source).toContain("['settings', 'restaurant-test']")
    expect(source).toContain('api.analytics.usageOverview(selectedAccountId)')
    expect(source).toContain('利用中 {inUse.toLocaleString')
    expect(source).toContain('利用数は未取得')
    expect(source).toContain('px-3 py-2')
    expect(source).toContain('<div key={columnIndex} className="space-y-3">')
    expect(source).not.toContain('!ordering && columnIndex === 2')
  })

  it('利用数は後から読み、失敗時は読み直せる', () => {
    // 重い集計で設定の表示を待たせない。以前は Promise.all で一緒に待っていた。
    expect(source).toContain('const loadUsage = useCallback')
    expect(source).toContain('void loadUsage()')
    expect(source).toContain('usageFailed')
    expect(source).toContain('利用数を読み直す')
    expect(source).not.toContain('usageOverview(selectedAccountId).catch(() => null)')
  })

  it('保存後はサーバ値を読み直して確定する', () => {
    // 無効環境でサーバーが正した値（飲食店テストなど）をオン表示のままにしない。
    expect(source).toContain('サーバ値を読み直して確定')
    expect(source).toContain('setFeatures(serverFeatures)')
    expect(source).toContain('setSavedFeatures(serverFeatures)')
  })

  it('変更ありの判定は画面に出ないキーも比べる', () => {
    expect(source).toContain('Object.keys({ ...savedFeatures, ...features })')
  })
})
