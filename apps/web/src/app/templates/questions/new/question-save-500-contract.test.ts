import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(HERE, 'page.tsx'), 'utf8')

describe('templates/questions/new 保存の実行時失敗（500）', () => {
  it('保存の投げられ失敗は原因どおりの文で出す（実送なし）', () => {
    // 変更系は共通の失敗文で言い分ける（403の依頼案内つき）
    expect(page).toContain('describeApiFailure')
    expect(page).toContain('ApiError')
    // 実送はしない（保存の投げられ失敗の契約だけ）
    expect(page).not.toContain('fetch(')
  })
})
