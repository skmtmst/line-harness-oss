import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROW = fs.readFileSync(new URL('../../app/users/users-screen.tsx', import.meta.url), 'utf8')

/** 注釈を落とす。「なぜ消したか」を書いた文が、消したはずの字面に当たるのを避ける。 */
function code(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const CODE = code(ROW)

describe('統合ユーザーの行は、LINEユーザーIDを画面に出さない', () => {
  it('IDを縮めて出す関数を持たない', () => {
    expect(CODE, 'shortenUid が残っている').not.toContain('shortenUid')
  })

  it('lineUserId を描画にも title にも渡さない', () => {
    expect(CODE, 'title に全文を入れている').not.toContain('title={primaryUid}')
    expect(CODE, 'title に全文を入れている').not.toContain('title={a.lineUserId}')
    expect(CODE, '本文にIDを出している').not.toContain('UID: {')
  })

  it('状態の言葉は残っている', () => {
    expect(CODE).toContain('{UID_STATUS[row.identityKeyKind]}')
    expect(CODE).toContain("url_token: '要確認'")
    expect(CODE).toContain("uid: 'UIDで連携'")
    expect(CODE).toContain("solo: '未連携'")
  })

  it('アカウントごとの行は、IDの代わりに状態の言葉を出す', () => {
    expect(CODE).toContain("{a.isFollowing ? '友だち' : 'ブロック・削除'}")
  })
})
