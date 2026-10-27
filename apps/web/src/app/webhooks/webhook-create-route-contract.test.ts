import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * 送り先を作る口は専用の作成画面だけが叩く（禁止の見張り）。
 * 一覧の作る導線の行き先と保存後の戻り先は v8/webhooks/overview-behavior・create-events の試験が画面で確かめる。
 */
describe('送信Webhookの作成経路', () => {
  it('一覧は作成の口を直接叩かない', () => {
    expect(readFileSync(new URL('../../v8/webhooks/outgoing.tsx', import.meta.url), 'utf8')).not.toContain('api.webhooks.outgoing.create')
  })
})
