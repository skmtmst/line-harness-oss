import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

/*
 * 一覧が空の時は「印→見出し→1文→作るボタン1つ」の共通の形（EmptyList）を使う（2026-10-25）。
 * 機械で拾った、素の <p> で「ありません」と書いていた2画面を共通の形へ寄せた。
 */
describe('空の一覧は共通の形', () => {
  it.each([
    ['v8/hq-deliveries/console.tsx', /<EmptyList[^>]*title=\{`まだ\$\{titleOf\(type\)\}のひな形がありません`\}[^>]*create=\{\{ label: 'ひな形を作る'/s],
    ['v8/hq/support.tsx', /<EmptyList[^>]*title="まだ問い合わせはありません"[^>]*canCreate=\{false\}/s],
  ])('%s は EmptyList を使い、素の文で空を書かない', (rel, pattern) => {
    const src = read(rel)
    expect(src).toMatch(pattern)
    expect(src).not.toMatch(/<p[^>]*>[^<]*(?:ひな形がありません|まだ問い合わせはありません)/)
  })
})
