import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const directory = dirname(fileURLToPath(import.meta.url))
const staffSource = readFileSync(join(directory, 'page.tsx'), 'utf8')

/*
 * R67: 項目を個別に触ったあとで「受付」などの かたまりを選んでも、
 * 古い個別の上書きが残っていると、表示は新しいかたまりなのに
 * 保存は古い個別設定になる（配信権限が残る）。選び直したら
 * 上書きは捨て、表示どおりに保存する。
 */
describe('R67 かたまりの選び直しは個別の上書きを捨てる', () => {
  it('かたまりから選ぶと個別の上書きを捨てる', () => {
    const preset = staffSource.slice(staffSource.indexOf('かたまりから選ぶ'))
    expect(preset).toContain('setCustomLevels(null)')
    expect(preset).toContain('setBundle(value)')
  })

  it('ほかの人と同じにするときも個別の上書きを捨てる', () => {
    const copy = staffSource.slice(
      staffSource.indexOf('const copyBundle'),
      staffSource.indexOf('const featureItems'),
    )
    expect(copy).toContain('setCustomLevels(null)')
    expect(copy).toContain('setBundle(source.roleBundle)')
  })

  it('保存は上書きがあるときだけ項目ごと送る', () => {
    // 上書きが null（かたまり通り）なら permissionScope を送らず、
    // サーバー側で選んだかたまりのまま保存する。
    // R497: 個別設定の人が行だけ触ったときは行単位のキー送りになる。
    expect(staffSource).toContain('permissionScope: surgical ? undefined : (customLevels ?? undefined)')
    expect(staffSource).toContain('const surgical = isCustom && hasSaved')
  })
})
