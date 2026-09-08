import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const dir = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(dir, 'page.tsx'), 'utf8')
const worker = readFileSync(join(dir, '..', '..', '..', '..', '..', 'apps', 'worker', 'src', 'routes', 'operations.ts'), 'utf8')

describe('N-453 止められない理由を画面に出す', () => {
  it('停止不可の機械コードを口と画面で同じ文字で連携する', () => {
    for (const code of ['EMERGENCY_CONTROL_FORBIDDEN', 'EMERGENCY_SCOPE_FORBIDDEN']) {
      expect(worker).toContain(`code: '${code}'`)
      expect(page).toContain(code)
    }
    expect(worker).toContain('reasonCode')
    expect(page).toContain('reasonCode')
  })

  it('権限がないとき運用者向け文言と次の行動を表示する', () => {
    expect(page).toContain('いまは緊急停止できません')
    expect(page).toContain('オーナーに権限付与を依頼してください')
    expect(page).toContain('対象アカウントを選び直すか、オーナーに確認してください')
    expect(page).toContain('停止する配信を1つ以上選んでください')
  })

  it('403は機械コードで文言を選び、口の文言をそのまま出さない', () => {
    expect(page).toContain('error.status === 403')
    expect(page).toContain('operationBlockedText(error.code)')
  })

  it('取得失敗時も理由を出し、読み込み中だけ出さない', () => {
    expect(page).toContain('previewSettled')
    expect(page).toContain('impact !== null || impactFailed')
  })
})

describe('N-455 競合後に読み直してやり直せる', () => {
  it('競合の機械コードと最新状態を口が返す', () => {
    expect(worker).toContain("code: 'VERSION_CONFLICT'")
    expect(worker).toContain('data: result.control')
  })

  it('409で読み直し操作を表示し、成功後は確認をやり直せる', () => {
    expect(page).toContain('error.status === 409')
    expect(page).toContain('setNeedsReload(true)')
    expect(page).toContain('最新の状態を読み直す')
    expect(page).toContain('別の管理者が先に変更しました')
    // 成功・読み直し成功では合図を消し、確認ダイアログは閉じない(やり直せる)。
    expect(page).toContain('setNeedsReload(false)')
    expect(page).toContain('最新の状態を読み直しました。内容を確認して、もう一度実行してください。')
  })

  it('読み直しは対象切替と同じ口を使い、失敗も黙らせない', () => {
    expect(page).toContain('api.operations.preview(accountId)')
    expect(page).toContain('reloadControl')
    expect(page).toContain('最新の状態を読み直せませんでした。時間をおいてもう一度読み直してください。')
  })
})
