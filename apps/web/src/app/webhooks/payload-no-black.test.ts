import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 黒をなくす（#3・オーナー「黒がいや」）：Webhook の JSON の中身は
 * 薄い灰（pearl地＋ink字＋hairline枠）。コード表示を黒地にしない。
 * 黒（ink地）に戻さないための歯止め。
 */
/* やり取りの記録の入口は V8 のとき src/v8/webhooks/interactions.tsx（2026-10-06〜。古い interactions-v8.module.css はもう描かれない）。 */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'v8', 'webhooks', 'interactions.module.css'), 'utf8')

describe('Webhook の JSON は薄い灰（黒をなくす #3）', () => {
  it('.payloadBox は pearl地＋ink字（ink地にしない）', () => {
    const box = css.match(/\.payloadBox \{[^}]*\}/s)?.[0] ?? ''
    // 選択子が消えたら空文字で not.toMatch が通ってしまうので、在ることを先に確かめる。
    expect(box, '.payloadBox が見つからない').not.toBe('')
    expect(box).toMatch(/background:\s*var\(--color-surface-pearl\)/)
    expect(box).toMatch(/color:\s*var\(--color-ink\)/)
    expect(box).not.toMatch(/background:\s*var\(--color-ink\)/)
  })
})
