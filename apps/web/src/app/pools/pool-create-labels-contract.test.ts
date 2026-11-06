import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { describe, expect, it } from 'vitest'

const CREATE = readUiSource(new URL('./new/page.tsx', import.meta.url), 'utf8')

describe('V8 プール作成の常時ラベル (R617)', () => {
  it('入力欄と受け入れ先に常時表示の項目名がある', () => {
    expect(CREATE).toContain('label="プール名"')
    expect(CREATE).toContain('label="URLに使う名前（あとから変えられません）"')
    expect(CREATE).toContain('2. いまの受け入れ先')
  })
  it('入力後も項目名を表示する共通 Field を使う', () => {
    expect(CREATE).toMatch(/<Field label="プール名"[\s\S]*?<TextField id="pl-name"/)
    expect(CREATE).toMatch(/label="URLに使う名前（あとから変えられません）"[\s\S]*?<TextField id="pl-slug"/)
  })
  it('URL名とプール名は htmlFor と id で明示的に結び付く', () => {
    for (const id of ['pl-name', 'pl-slug']) {
      expect(CREATE).toContain(`htmlFor="${id}"`)
      expect(CREATE).toContain(`id="${id}"`)
    }
  })
  it('共通 Field の説明はラベルと分け、読み上げ名を汚さない', () => {
    expect(CREATE).toContain('note={<>')
    expect(CREATE).toContain('label="URLに使う名前（あとから変えられません）"')
    expect(CREATE).not.toMatch(/<label[^>]*>[\s\S]*?<HelpTip/)
  })
  it('受け入れ先を追加する選択欄に読み上げ名がある', () => {
    expect(CREATE).toMatch(/<EntitySelect[^>]*aria-label="足すアカウント"/)
    expect(CREATE).toContain('aria-labelledby="pool-create-where"')
  })
  it('入力例と選択欄の読み上げ名を残す', () => {
    expect(CREATE).toContain('placeholder="shibuya"')
    expect(CREATE).toContain('placeholder="例：渋谷エリア"')
    expect(CREATE).toContain('aria-label="足すアカウント"')
  })
  it('URL名の意味と変更できない理由を V8 の説明欄で示す', () => {
    expect(CREATE).toContain('保存すると、このURLが発行されます：')
    expect(CREATE).toContain('配ったURLが使えなくなるため、あとから変えられません。')
  })
})
