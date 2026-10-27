/*
 * 友だち詳細から受信箱へ渡す形の禁止の見張り。
 *
 * 受信箱は `?friend=` だけを読む。`?friendId=` で渡すと対象が引き継がれず既定の一覧へ着く。
 * 全導線が `?friend=` で渡すことは friend-detail-tabs-behavior.test.tsx が描いて押して確かめる。
 * ここは `?friendId=` の渡し方が無いことだけを見る。
 */
import { readUiSource as readFileSync } from '../../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

describe('友だち詳細の全導線は受信箱の読む形で渡す', () => {
  it('旧い渡し方 `chats?friendId=` が残っていない', () => {
    expect(PAGE).not.toContain('chats?friendId=')
  })
})
