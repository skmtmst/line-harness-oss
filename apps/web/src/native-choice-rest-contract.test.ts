/**
 * m21u: 素の radio・checkbox 残りの置き換え契約。
 *
 * 本線（components/shared の部品の中・試験を除く）に素の
 * `input[type="radio"]`・`input[type="checkbox"]` を直接書かない。
 * 共通の RadioCard・Checkbox を使う。1件でも素に戻すと赤になる。
 *
 * 例外: app/scenarios/mode/page.tsx の比較カード1件は、表入りの見比べを
 * 残すため素のまま（使いやすさ優先の判断。詳細は報告に書く）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)))
const EXCEPTIONS = new Set([
  'app/scenarios/mode/page.tsx',
  /*
   * リマインダV8の選ぶカード（ChoiceCardV8）は共通 RadioCard が持たない
   * 「アイコン左上・丸右上」の形。丸は本物の input[type=radio] で、
   * 意味は保ったまま。★V8板（YChR6等）の見た目を守るために残す。
   */
  'app/reminders/wizard-v8-ui.tsx',
])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      walk(full, out)
    } else if (name.endsWith('.tsx') && !name.includes('.test.') && !name.includes('.stories.')) {
      out.push(full)
    }
  }
  return out
}

describe('m21u: 素の選ぶ入力は残っていない', () => {
  it('本線に type="radio"・type="checkbox" の直書きがない（例外を除く）', () => {
    const offenders: string[] = []
    for (const full of walk(SRC)) {
      const relative = full.slice(SRC.length + 1)
      if (relative.startsWith('components/shared/')) continue
      if (EXCEPTIONS.has(relative)) continue
      const body = readFileSync(full, 'utf8')
      if (body.includes('type="radio"') || body.includes('type="checkbox"')) {
        offenders.push(relative)
      }
    }
    expect(offenders).toEqual([])
  })

  it('例外の比較カードは使いやすさのために残している', () => {
    const body = readFileSync(join(SRC, 'app/scenarios/mode/page.tsx'), 'utf8')
    expect(body).toContain('type="radio"')
  })
})
