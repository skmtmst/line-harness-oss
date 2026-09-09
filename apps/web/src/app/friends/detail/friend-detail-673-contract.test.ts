/*
 * #673（点検 #617 N-033）の再発防止の契約テスト（送り側）。
 *
 * 詳細画面の「受信箱で開く」6導線が `?friendId=` で渡し、受信箱は
 * `?friend=` しか読まなかったため、対象が引き継がれず既定一覧へ
 * 着いていた。全導線が安全なURL状態で渡すことをここで固定する。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')

describe('#673-送り 友だち詳細の全導線は受信箱の読む形で渡す', () => {
  it('旧い渡し方 `chats?friendId=` が残っていない', () => {
    expect(PAGE).not.toContain('chats?friendId=')
  })

  it('受信箱への口は `?friend=` に符号化して渡す', () => {
    expect(PAGE).toContain('function inboxHrefForFriend(friendId: string)')
    expect(PAGE).toContain('`/chats?friend=${encodeURIComponent(friendId)}`')
  })

  it('6導線すべてがその口を使う（上ボタン・対応・名前・タグ・追加・操作節）', () => {
    const uses = PAGE.split('inboxHrefForFriend(friendId)').length - 1
    expect(uses).toBe(6)
  })

  it('「受信箱で開く」の表示は残っている', () => {
    expect(PAGE).toContain('受信箱で開く')
  })
})
