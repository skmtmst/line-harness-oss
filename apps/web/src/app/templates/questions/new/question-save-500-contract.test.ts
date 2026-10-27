import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(HERE, '../../../../v8/templates/question-new.tsx'), 'utf8')

/* 失敗の文の言い分けは question-template-react.test.tsx で、保存を失敗させて確かめる。 */
describe('templates/questions/new 保存の実行時失敗（500）', () => {
  it('保存の投げられ失敗は原因どおりの文で出す（実送なし）', () => {
    // 実送はしない（保存の投げられ失敗の契約だけ）
    expect(page).not.toContain('fetch(')
  })
})
