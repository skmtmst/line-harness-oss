import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 監査 Issue #1058（必須パラメータ欠落時のガード）の契約。
 *
 * - `?id=` なし・対象未選択で「読み込んでいます」や真っ白な画面にしない
 * - 編集ルートで `?id=` が無いとき新規作成の器を出さない
 * - useSearchParams は Suspense の内側だけで使う（静的書き出しのため）
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(HERE, path), 'utf8')

/** `export default function …() { … }` の本体だけを取り出す。 */
const defaultExportBody = (source: string): string =>
  source.match(/export default function \w+\(\) \{[\s\S]*?\n\}/)?.[0] ?? ''

describe('#1058 必須パラメータ欠落時のガード', () => {
  it('accounts/detail: `?id=` なしで無限ローディングにせず一覧へ戻す', () => {
    const page = read('accounts/detail/page.tsx')
    expect(page).toContain('if (!id)')
    expect(page).toContain('見るアカウントが指定されていません')
    // 戻り先は ★V7 TargetMissing の backHref が持つ。
    expect(page).toContain('backHref="/accounts"')
  })

  it('accounts/handover: `?id=` なしで無限ローディングにせず一覧へ戻す', () => {
    const page = read('accounts/handover/page.tsx')
    expect(page).toContain('if (!id)')
    expect(page).toContain('乗り換えるアカウントが指定されていません')
    expect(page).toContain('backHref="/accounts"')
  })

  it('nen/members: アカウント未選択で真っ白にせず選び直しを案内する', () => {
    const page = read('nen/members/page.tsx')
    // 以前は `{!selectedAccountId ? null : …}` で何も出なかった。
    expect(page).not.toContain('!selectedAccountId ? null')
    expect(page).toContain('LINEアカウントを選んでください')
  })

  it('tags/marks/edit: `?id=` なしで新規作成の器を出さず一覧へ戻す', () => {
    const page = read('tags/marks/edit/page.tsx')
    // 編集ルートで id 無し＝作成画面を見せるのは黙った状態遷移なので止める。
    expect(page).toContain('編集する対応マークが指定されていません')
    expect(page).toContain('backHref="/tags?tab=marks"')
    expect(page).toContain('if (!id)')
    expect(page).toContain('return <SupportMarkEditor markId={id} />')
    // 新規作成は /tags/marks/new が担う。編集側へ undefined を渡さない。
    expect(page).not.toContain('markId={id ?? undefined}')
  })
})

describe('#1058 useSearchParams は Suspense の内側だけで使う', () => {
  /*
    静的書き出し（output: 'export'）では Suspense なしの useSearchParams が
    ビルドを止める。既定の出口（export default）では検索パラメータを読まず、
    内側のコンポーネントを <Suspense> で包む形にそろえる。
  */
  const pages = [
    'reminders/detail/page.tsx',
    'friend-add-settings/page.tsx',
    'friend-add-settings/runs/page.tsx',
    'friend-add-settings/runs/detail/page.tsx',
    'auto-replies/runs/page.tsx',
  ]

  for (const path of pages) {
    it(`${path} の既定の出口は useSearchParams を呼ばず <Suspense> で包む`, () => {
      const page = read(path)
      const body = defaultExportBody(page)
      expect(body).not.toBe('')
      expect(body).toContain('<Suspense')
      // 既定の出口で呼ばない（注意書きの「useSearchParams は」は呼び出しではない）。
      expect(body).not.toMatch(/useSearchParams\s*\(/)
      // 内側のコンポーネント側で読むことも確かめる。
      expect(page).toMatch(/useSearchParams\s*\(/)
    })
  }
})
