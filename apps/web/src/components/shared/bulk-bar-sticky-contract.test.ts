import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * 動きの点検（2026-10-07）12 番：一括バーが表の下に並ぶだけで、長い一覧では
 * 画面の外に出ていた。共通の一括バーと、自前の帯を持つ主な一覧は、画面の下に付いてくる。
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FILES: Array<[string, string]> = [
  ['components/shared/bulk-bar.module.css', '.bar'],
  ['v8/scenarios/list.module.css', '.bulkRow'],
  ['v8/auto-replies/list.module.css', '.bulkRow'],
  ['app/reminders/list-v8.module.css', '.bulkRow'],
  ['app/templates/list-v8.module.css', '.bulkRow'],
]

function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  return start < 0 ? '' : css.slice(start, css.indexOf('}', start))
}

describe('一括バーは長い一覧でも画面の下に付いてくる', () => {
  it.each(FILES)('%s の %s は position: sticky・bottom を持つ', (file, selector) => {
    const body = block(readFileSync(join(SRC, file), 'utf8'), selector)
    expect(body).toMatch(/position:\s*sticky/)
    expect(body).toMatch(/bottom:/)
  })
})
