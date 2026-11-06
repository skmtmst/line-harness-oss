/*
 * 画面確認の偽 API が返す会話の詳細に、受信箱の見出しが読む本名と注目の印が載っているか。
 * 載っていないと、撮った受信箱の見出しから本名と★が黙って消える（絵の照合で気づけない）。
 * 偽 API を本当に立てて、一覧の会話ごとに詳細を読む。
 * 注目付きの会話は固定データに無いので、注目の写し方は apps/web/src/components/chats/inbox-v4-contract.test.ts が文字で見る。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error 画面確認用のスクリプトは素のJS。型定義は持たない。
import { CHATS, FRIEND_DETAILS } from './fixtures.mjs'

type ChatRow = { id: string; friendId: string }
type FriendDetail = { realName?: string | null; metadata?: Record<string, unknown> | null }

describe('画面確認の偽 API：受信箱の会話の詳細', () => {
  let child: ChildProcess
  let baseUrl: string

  beforeAll(async () => {
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') return reject(new Error('空きポートを取得できませんでした'))
        server.close((error) => error ? reject(error) : resolve(address.port))
      })
    })
    baseUrl = `http://127.0.0.1:${port}`
    child = spawn(process.execPath, [fileURLToPath(new URL('./mock-api.mjs', import.meta.url))], {
      env: { ...process.env, PORT: String(port) },
      stdio: 'ignore',
    })
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        if ((await fetch(`${baseUrl}/__mock-fingerprint`)).ok) return
      } catch { /* 起動待ち */ }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('偽 API が起動しませんでした')
  })

  afterAll(() => { child?.kill('SIGTERM') })

  it('会話の詳細は、友だちの本名と注目の印（metadata.__attention）を返す', async () => {
    const rows = CHATS as ChatRow[]
    const friends = FRIEND_DETAILS as Record<string, FriendDetail>
    let withRealName = 0
    for (const row of rows) {
      const response = await fetch(`${baseUrl}/api/chats/${encodeURIComponent(row.id)}`)
      expect(response.status, row.id).toBe(200)
      const body = await response.json() as { data: { friendRealName: string | null; isAttention: boolean } }
      const friend = friends[row.friendId]
      expect(body.data.friendRealName, row.id).toBe(friend?.realName ?? null)
      expect(body.data.isAttention, row.id).toBe(friend?.metadata?.__attention === '1')
      if (body.data.friendRealName) withRealName += 1
    }
    // 本名ありの会話が1件も無いと、上の確かめは何も見ていない。
    expect(withRealName).toBeGreaterThan(0)
  })
})
