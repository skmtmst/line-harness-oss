import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PICKER = readFileSync(join(HERE, 'template-picker.tsx'), 'utf8')

/**
 * 受信箱のテンプレート選択(#645 差し戻し・要件1)。
 * 選んでいるアカウントを口へ必ず渡し、未公開・他アカウントを候補にしない。
 * 口の主 messageType/messageContent は公開版だけが返る。
 */
describe('受信箱のテンプレート選択は公開版だけを選ばせる', () => {
  it('選んでいるアカウントを一覧口へ必ず渡す', () => {
    expect(PICKER).toContain('api.templates.list(undefined, requestAccountId ?? undefined)')
  })

  it('未公開・他アカウントを候補から外す', () => {
    expect(PICKER).toContain('filterSendableTemplates(')
  })

  it('アカウント切替後に前アカウントの候補を見せない', () => {
    expect(PICKER).toContain('accountDataCurrent')
    expect(PICKER).toContain('loadedAccountId === selectedAccountId')
  })
})
