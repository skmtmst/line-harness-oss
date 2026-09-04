import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
const GALLERY = readFileSync(new URL('../../components/automations/automation-template-gallery.tsx', import.meta.url), 'utf8')
const EDITOR = readFileSync(new URL('../../components/automations/automation-draft-editor.tsx', import.meta.url), 'utf8')
const API = readFileSync(new URL('../../lib/api.ts', import.meta.url), 'utf8')

describe('V6 25-1-C 見本から下書きを作る', () => {
  it('見本タブを実Nodeへ接続し、サーバーから使える見本だけを読む', () => {
    expect(PAGE).toContain("{ key: 'templates', label: '見本' }")
    expect(PAGE).toContain('<AutomationTemplateGallery accountId={selectedAccountId}')
    expect(GALLERY).toContain('data-design-node="WjYAC"')
    expect(GALLERY).toContain('api.automations.templates(accountId)')
    expect(GALLERY).not.toContain('誕生日クーポン')
  })

  it('見本選択は公開せず下書きを作り、その下書きの編集へ進む', () => {
    expect(GALLERY).toContain('api.automations.createDraftFromTemplate(item.key, accountId)')
    /*
      **下書きは「ルールを作る」とは別の画面。** 白紙から作る `Rv8Jv` と
      出発点が違ううえ、同じ画面に混ぜると設計の骨格に下書き側の節が混ざり、
      どちらの画面を見ているのか読めなくなる（`design-structure.test.ts`）。
    */
    expect(GALLERY).toContain('/automations/drafts?id=')
    expect(GALLERY, '白紙の作成画面へ落とさない').not.toContain('/automations/new?draftId=')
    expect(EDITOR).toContain('api.automations.getDraft(draftId, selectedAccountId)')
    expect(EDITOR).toContain('api.automations.draftResources(selectedAccountId)')
    expect(EDITOR).toContain('api.automations.updateDraft(draftId, selectedAccountId')
    expect(EDITOR).toContain('公開するまでは下書きのままです')
    expect(API).toContain('/api/automation-templates/')
    expect(API).toContain('/api/automation-drafts/')
  })

  it('見本の資源IDを使わず、タグとシナリオを選び直させる', () => {
    expect(EDITOR).toContain('見本は実データIDを持たないため、必ず選び直します。')
    expect(EDITOR).toContain("if (eventType === 'tag_change' && !triggerTagId)")
    expect(EDITOR).toContain("if (actionType === 'add_tag' && !actionTagId)")
    expect(EDITOR).toContain("if (actionType === 'start_scenario' && !actionScenarioId)")
  })

  it('未取得・空・失敗を別にし、失敗時に下書きを作ったように見せない', () => {
    expect(GALLERY).toContain("'loading' | 'ready' | 'error'")
    expect(GALLERY).toContain('見本を表示できませんでした')
    expect(GALLERY).toContain('いま使える見本はありません')
    expect(GALLERY).toContain('まだ下書きは作っていません')
    expect(GALLERY).toContain('下書きを作れませんでした')
    expect(GALLERY).not.toContain('error.message')
    expect(EDITOR).toContain('下書きを保存できませんでした。状態を読み直してから')
  })
})
