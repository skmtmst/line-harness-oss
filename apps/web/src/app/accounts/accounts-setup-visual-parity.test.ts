import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const directory = dirname(fileURLToPath(import.meta.url))
const setupSource = readFileSync(join(directory, 'new/page.tsx'), 'utf8')
const hierarchySource = readFileSync(join(directory, 'account-hierarchy.tsx'), 'utf8')

describe('V2 10-1 Pen準拠のアカウントUI', () => {
  it('追加画面を5ステップの3カラム構成にする', () => {
    expect(setupSource).toContain("xl:grid-cols-[265px_minmax(0,1fr)_290px]")
    for (const label of ['設定の進み具合', 'このステップの完了条件', 'アカウント追加まで', '設定に迷ったとき']) {
      expect(setupSource).toContain(label)
    }
    expect(setupSource).toContain('すべての接続確認が完了するまでアカウントは追加されません')
    expect(setupSource).toContain('disabled={!allVerified || saving}')
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
