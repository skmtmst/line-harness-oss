import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(here, 'page.tsx'), 'utf8')

describe('V6 シナリオ作成・配信方式 cCB7r', () => {
  it('Pencilの実Nodeと3段の進み方を表示する', () => {
    expect(page).toContain('data-design-node="cCB7r"')
    /*
      段の見た目は共通部品（`components/shared/step-trail`）へ移した。
      **同じ形を2か所で別々に書かない**ため。`aria-label` と ✓ の出し方は
      部品側の試験（`step-trail.test.tsx`）が見張る。ここでは
      **この画面が3段を、正しい名前と状態で渡しているか**を見る。
    */
    expect(page).toContain("import StepTrail from '@/components/shared/step-trail'")
    expect(page).toContain('label="シナリオ作成の進み方"')
    expect(page).toContain("{ label: 'シナリオ情報', state: 'done' }")
    expect(page).toContain("{ label: '配信方式', state: 'current' }")
    expect(page).toContain("{ label: '1通目を設定', state: 'todo' }")
  })

  it('既存のシナリオ用フォルダを読み、名前と分類を同じ受け口へ保存する', () => {
    expect(page).toContain("api.folders.list('scenario')")
    expect(page).toContain('folderId: nextFolder')
    expect(page).toContain('folderId: folderId || null')
    expect(page).toContain("setFolderId(res.data.folderId ?? '')")
    expect(page).toContain("import SelectField from '@/components/shared/select-field'")
    expect(page).toContain("{ value: '', label: '未分類' }")
    expect(page).toContain("...(selectedFolderMissing ? [{ value: folderId, label: '名前を確認できません' }] : [])")
    expect(page).toContain("...folders.map((folder) => ({ value: folder.id, label: folder.name }))")
    expect(page).toContain('className="v6-select ')
  })

  it('フォルダを取得できないとき未分類と決めつけず変更を止める', () => {
    expect(page).toContain("useState<'loading' | 'ready' | 'error'>('loading')")
    expect(page).toContain("disabled={!scenario || folderState !== 'ready' || detailsSaving || saving !== null}")
    expect(page).toContain('フォルダを確認できないため、いまは変更できません。')
    expect(page).toContain("folderState === 'error'")
    expect(page).toContain("? '確認できません'")
    expect(page).toContain("folderState === 'loading'")
    expect(page).toContain("? '読み込み中…'")
  })

  it('選んだ配信方式とフォルダを保存してから3段目へ進む', () => {
    const choose = page.slice(page.indexOf('const choose = async'), page.indexOf('const continueAsDraft'))
    expect(choose.indexOf('api.scenarios.update(id, {')).toBeGreaterThan(-1)
    expect(choose.indexOf('api.scenarios.update(id, {')).toBeLessThan(
      choose.indexOf('router.push(`/scenarios/first-step'),
    )
    expect(choose).toContain('folderId: folderId || null')
    expect(choose).toContain('deliveryMode: mode')
    expect(choose).toContain('router.push(`/scenarios/first-step?id=${encodeURIComponent(id)}`)')
  })

  it('下書きで続ける場合も名前とフォルダの保存成功後だけ進む', () => {
    const start = page.indexOf('const continueAsDraft')
    const draft = page.slice(start, page.indexOf("if (!id) {", start))
    expect(draft).toContain('const saved = await saveDetails()')
    expect(draft).toContain('if (saved) router.push(`/scenarios/first-step')
    expect(page).not.toContain('href={`/scenarios/first-step')
  })

  it('APIの内部エラーをそのまま利用者へ出さない', () => {
    expect(page).toContain('function scenarioSaveError')
    expect(page).toContain('function scenarioModeError')
    expect(page).not.toContain('setError(res.error)')
  })

  it('シナリオ読込中・失敗時に作成済みと表示せず方式の確定を止める', () => {
    expect(page).toContain("useState<'loading' | 'ready' | 'error'>('loading')")
    expect(page).toContain('data-list-state={scenarioState}')
    expect(page).toContain("scenarioState === 'loading'")
    expect(page).toContain("scenarioState === 'ready' && scenario")
    expect(page).toContain('disabled={!scenario || detailsSaving}')
    expect(page).toContain('disabled={disabled || saving !== null}')
  })
})
