/*
 * #548（点検 #493 の「中」の残り）の再発防止の契約テスト。
 *
 * 7番: `api.chats.get` の型が実応答とずれていた（`senderType`）。
 * 9番: メール取得の失敗が無言で「メール0件」に見えた。
 *
 * 画面の契約テストの流儀に従い、対象の区間だけを切り出して見る。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = readFileSync(join(HERE, 'page.tsx'), 'utf8')
const API = readFileSync(join(HERE, '..', '..', 'lib', 'api.ts'), 'utf8')

/**
 * `start` から `end` までを切り出す。**印が無ければ落とす。**
 * 印を消したまま試験が通ると、何も見ていない試験になる。
 */
function region(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  if (from < 0) throw new Error(`区間の始まりが見つかりません: ${start}`)
  const to = source.indexOf(end, from + start.length)
  if (to < 0) throw new Error(`区間の終わりが見つかりません: ${end}`)
  return source.slice(from, to)
}

describe('#548-7 会話詳細の型は口の実応答に従う', () => {
  const messageType = region(API, 'export interface ChatDetailMessage', '\n}')
  const chatsGet = region(API, 'get: (id: string, params?', 'create: (data:')

  it('口の項目（向き・種別・職員名・シナリオ名）を持ち、senderType は無い', () => {
    expect(messageType).toContain("direction: 'incoming' | 'outgoing'")
    expect(messageType).toContain('messageType: string')
    expect(messageType).toContain('sentByStaffName: string | null')
    expect(messageType).toContain('scenarioName: string | null')
    expect(messageType).not.toContain('senderType')
  })

  it('chats.get はメッセージの型に ChatDetailMessage を使う', () => {
    expect(API).toContain('messages: ChatDetailMessage[]')
    expect(chatsGet).toContain('fetchApi<ApiResponse<ChatDetail>>')
    expect(chatsGet).not.toContain('senderType')
  })

  it('画面は独自のメッセージ型を持たず、共通の型に寄せる', () => {
    expect(PAGE).toContain('type ChatDetail = ApiChatDetail')
    expect(PAGE).not.toContain('type ChatMessage')
    expect(PAGE).not.toContain('senderType')
    expect(PAGE).not.toContain('as unknown as')
  })
})

describe('#548-9 メール取得の失敗は専用の行で知らせる', () => {
  const loader = region(PAGE, 'const loadEmails = useCallback', '}, [statusFilter, debouncedNameQuery, loadingMoreEmails])')

  it('失敗したら専用の文言を出し、成功したら消す', () => {
    expect(PAGE).toContain('const [emailError, setEmailError]')
    expect(loader).toContain("setEmailError('メールの読み込みに失敗しました。')")
    expect(loader).toContain("setEmailError('')")
  })

  it('LINE側の失敗表示とは別に、読み込み直しのボタンを出す', () => {
    expect(PAGE).toContain('メールを読み込み直す')
    expect(PAGE).toContain('channel !== \'line\' && emailError')
  })
})
