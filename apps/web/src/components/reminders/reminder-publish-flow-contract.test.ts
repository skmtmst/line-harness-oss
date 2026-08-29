import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const FLOW = readFileSync(join(ROOT, 'src/components/reminders/reminder-publish-flow.tsx'), 'utf8')
const NEW_PAGE = readFileSync(join(ROOT, 'src/app/reminders/new/page.tsx'), 'utf8')
const API = readFileSync(join(ROOT, 'src/lib/api.ts'), 'utf8')

describe('V6 リマインダの公開フロー', () => {
  it('未実装だった5画面を実Node IDで接続する', () => {
    for (const nodeId of ['s7T2dz', 'JCz6J', 'W98zZQ', 's6Vvp', 'PSmHo']) {
      expect(FLOW).toContain(`data-design-node="${nodeId}"`)
    }
  })

  it('作成時に公開せず、下書きから対象確認へ進む', () => {
    expect(NEW_PAGE).toContain('api.reminders.createDraft(settings)')
    expect(NEW_PAGE).toContain('&stage=target')
    expect(NEW_PAGE).not.toContain('api.reminders.addStep(res.data.id')
  })

  it('確認・テスト送信・公開を同じ版のAPIへ通す', () => {
    expect(API).toContain('/api/reminders/${id}/draft')
    expect(API).toContain('/api/reminders/${id}/preview')
    expect(API).toContain('/api/reminders/${id}/test-send')
    expect(API).toContain('/api/reminders/${id}/validate')
    expect(API).toContain('/api/reminders/${id}/publish')
    expect(FLOW).toContain("draft.lastTestStatus !== 'succeeded'")
    expect(FLOW).toContain('!validation?.valid')
  })

  it('未取得の人数を0人に見せない', () => {
    expect(FLOW).toContain("value == null ? `—${unit}`")
    expect(FLOW).toContain("audience.matched")
    expect(FLOW).toContain("audience.excluded")
  })

  it('本文に大見出しを重ねず、共通トップバーへ任せる', () => {
    expect(FLOW).not.toContain('<Header')
    expect(FLOW).not.toContain('<h1')
  })
})
