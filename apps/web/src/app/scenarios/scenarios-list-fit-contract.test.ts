import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * シナリオ一覧の絵どおり検査（m21p・V8）。
 *
 * 検証環境の撮影で見つかった崩れの再発防止。幅の確認そのものは
 * 司令塔が撮影で行う。ここでは絵の並びと見出しを文字で固定する。
 * 板 `axFrW`：頭 → 案内の帯（1つ・開閉なし） → 数の帯 → 道具の段 → 表。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const LIST = readFileSync(join(HERE, 'list-v8.tsx'), 'utf8')

describe('シナリオ一覧の絵どおり（m21p・V8）', () => {
  it('並びは「頭 → 案内の帯 → 数の帯 → 道具の段 → 表」', () => {
    const headAt = LIST.indexOf('data-design="Head"')
    const bandAt = LIST.indexOf('className={styles.noteBand}')
    const kpisAt = LIST.indexOf('data-design="KPIs"')
    const bodyAt = LIST.indexOf('data-design="Body"')
    expect(headAt, '頭が無い').toBeGreaterThan(-1)
    expect(bandAt, '案内の帯が頭より下に無い').toBeGreaterThan(headAt)
    expect(kpisAt, '数の帯が案内の帯より下に無い').toBeGreaterThan(bandAt)
    expect(bodyAt, '表が数の帯より下に無い').toBeGreaterThan(kpisAt)
  })

  it('案内の帯は開閉なしの1つだけ', () => {
    expect(LIST).not.toContain('<details')
    expect(LIST).toContain('作っただけでは送れません')
  })

  it('表の見出しは絵どおり（シナリオ・購読中・読み終えた・状態）', () => {
    expect(LIST).toContain('<Th>シナリオ</Th>')
    expect(LIST).toContain('<Th>購読中・読み終えた</Th>')
    expect(LIST).toContain('<Th>状態</Th>')
    expect(LIST).not.toContain('<Th>シナリオ名</Th>')
    expect(LIST).not.toContain('購読 / 読了')
  })
})
