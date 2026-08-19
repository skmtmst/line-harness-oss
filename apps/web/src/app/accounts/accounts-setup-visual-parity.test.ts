import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const directory = dirname(fileURLToPath(import.meta.url))
const setupSource = readFileSync(join(directory, 'new/page.tsx'), 'utf8')
const hierarchySource = readFileSync(join(directory, 'account-hierarchy.tsx'), 'utf8')

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
})
