/*
 * セッションが届かないときの合図。
 *
 * 管理画面とAPIは別サイトなので、ブラウザがサイトをまたぐCookieを止めると
 * **全部のAPIが401**になる。全画面が同時に壊れるのに、各画面が個別に
 * 「エラー」と出すだけでは原因に辿りつけない。1か所で受けられるように、
 * 401のときだけ合図を出す。
 *
 * 401以外で出してはいけない。権限不足(403)や不正な入力(400)まで
 * 「ログインが届いていません」と案内すると、別の原因を探しに行かせる。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, '..')

// api.ts は読み込むだけで NEXT_PUBLIC_API_URL を要求するので、
// 中身を文字列として読む。見たいのは「名前が揃っているか」だけ。
const apiSource = readFileSync(join(SRC, 'lib/api.ts'), 'utf8')
const noticeSource = readFileSync(join(SRC, 'components/session-lost-notice.tsx'), 'utf8')

describe('合図の名前', () => {
  it('出す側と受ける側で揃っている', () => {
    expect(apiSource).toContain("export const SESSION_LOST_EVENT = 'lh-session-lost'")
    expect(noticeSource).toContain("SESSION_LOST_EVENT")
    expect(noticeSource).toContain("addEventListener(SESSION_LOST_EVENT")
  })

  it('401 のときだけ合図を出している', () => {
    expect(apiSource).toContain('res.status === 401')
    expect(apiSource).toContain('SESSION_LOST_EVENT')
  })

  it('受け手は、ログインの跡があるときだけ案内を出す', () => {
    expect(noticeSource).toContain("const ROLE_KEY = 'lh_staff_role'")
    expect(noticeSource).toContain('if (!window.localStorage.getItem(ROLE_KEY)) return')
  })
})

/** fetchApi の 401 判定だけを取り出したもの。 */
function shouldAnnounceSessionLost(status: number): boolean {
  return status === 401
}

describe('どの応答で合図を出すか', () => {
  it('401 のときだけ出す', () => {
    expect(shouldAnnounceSessionLost(401)).toBe(true)
  })

  it('403（権限不足）では出さない', () => {
    // 「この機能を操作する権限がありません」は、ログインは届いている。
    expect(shouldAnnounceSessionLost(403)).toBe(false)
  })

  it('400 / 404 / 500 では出さない', () => {
    for (const status of [400, 404, 409, 500, 502]) {
      expect(shouldAnnounceSessionLost(status)).toBe(false)
    }
  })

  it('成功では出さない', () => {
    for (const status of [200, 201, 204]) {
      expect(shouldAnnounceSessionLost(status)).toBe(false)
    }
  })
})

describe('案内を出すかどうかの判定', () => {
  const ROLE_KEY = 'lh_staff_role'

  /** SessionLostNotice の判定だけを取り出したもの。 */
  function shouldShowNotice(storedRole: string | null): boolean {
    return Boolean(storedRole)
  }

  it('ログインの跡があるなら案内を出す（届いていないのが問題）', () => {
    expect(shouldShowNotice('admin')).toBe(true)
    expect(shouldShowNotice('owner')).toBe(true)
    expect(shouldShowNotice('staff')).toBe(true)
  })

  it('ログインの跡が無ければ出さない（ただの未ログイン）', () => {
    expect(shouldShowNotice(null)).toBe(false)
    expect(shouldShowNotice('')).toBe(false)
  })

  it('記録している鍵の名前が変わっていない', () => {
    // ログイン時にこの鍵で保存している。名前がずれると、
    // 未ログインと区別できなくなり、案内が出っぱなしになる。
    expect(ROLE_KEY).toBe('lh_staff_role')
  })
})
