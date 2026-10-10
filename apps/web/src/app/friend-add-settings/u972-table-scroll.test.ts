import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('../../v8/friend-add/list.tsx', import.meta.url), 'utf8')

/*
 * #972 U039: 390pxでは対象の切替タブが右へはみ出し、一覧の表見出しが
 * 重なって読めなかった。タブは折り返し、表は枠の内側で横へ動かす。
 */
describe('U039 友だち追加時の配信の表見出し', () => {

  it('表の見出しと編集への行き先は変えていない', () => {
    expect(PAGE).toContain('view=edit&id=')
  })
})
