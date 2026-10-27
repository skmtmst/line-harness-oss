import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

/**
 * #975 U067: 送るイベントをCSV文字列で手入力させない（禁止の見張り）。
 * 2択・チェック・送る種類コード・?event= の初期選択は v8/webhooks/create-events.test.tsx が画面で確かめる。
 */
describe('Webhookイベントの選択（#975 U067）', () => {
  it('CSV入力欄と素のチェックボックスを持たない', () => {
    expect(PAGE).not.toContain('id="wh-events"')
    expect(PAGE).not.toContain('カンマ区切り。* を入れると')
    expect(PAGE).not.toContain("eventTypes\n            .split(',')")
    // m21u: 素の input を共通の Checkbox へ置き換えた。直書きは残さない。
    expect(PAGE).not.toContain('type="checkbox"')
  })
})
