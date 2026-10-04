import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const V8 = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'feature-settings-v8.tsx'), 'utf8')

/** 設定の並び替えの窓（板 `ztgRD`）の言葉を絵に合わせる歯止め。 */
describe('ztgRD 並び替えの窓', () => {
  it('つまみと矢印の動かし方を説明する', () => {
    expect(V8).toContain('つまみで動かすか、矢印で1つずつ動かします')
  })

  it('戻す・決めるボタンを絵の言葉にする', () => {
    expect(V8).toContain('元の並びに')
    expect(V8).toContain('この並びにする')
    expect(V8).not.toContain('元の並びに戻す')
  })
})
