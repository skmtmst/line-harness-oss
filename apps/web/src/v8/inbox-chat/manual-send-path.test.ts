/*
 * 担当者の1対1の手動返信（受信箱の［送信］）の経路を見張る（B-6 で動画・ファイルを足しても変えない）。
 *
 * 受信箱の送信は LINE Harness Proxy を通らず、受信箱の口 `POST /api/chats/:id/send` へ直接送る。
 * 口（apps/worker の chats.ts）が担当者の手動返信として source='manual' で記録し、自動の配信の
 * 数に入れない。Proxy の印 `X-Line-Harness-Source: manual` は Proxy 経由の push のための印で、
 * この経路では付けない（worker の chat-attachments.test.ts も「付けない」を見ている）。
 * 予約した送信（あとで自動で出る）も手動の印は付けない。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { attachmentSendInput } from './attachments'

let api: typeof import('@/lib/api').api
beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example'
  ;({ api } = await import('@/lib/api'))
})
afterEach(() => { vi.unstubAllGlobals() })

const ok = () => new Response(JSON.stringify({ success: true, data: { sent: true, messageId: 'm', sentByStaffName: 'Kenta', revision: 2 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
const attachment = { id: 'f1', key: 'k', url: 'https://worker.example/a/f1', filename: '案内.pdf', mimeType: 'application/pdf', size: 10, kind: 'file' as const, expiresAt: '2026-11-07T03:00:00.000Z' }

describe('受信箱の手動返信の経路', () => {
  it.each([
    ['本文', { content: 'こんにちは' }],
    ['動画', attachmentSendInput({ ...attachment, kind: 'video', id: 'v1', url: 'https://worker.example/a/v1' })],
    ['ファイル', attachmentSendInput(attachment)],
  ])('%sは受信箱の送信口へ直接送り、二重送信止めの鍵を付け、Proxy の印は付けない', async (_label, input) => {
    const fetch = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetch)
    await api.chats.send('friend-0', input, 'send-key-1')
    const [url, init] = fetch.mock.calls[0]
    expect(String(url)).toMatch(/\/api\/chats\/friend-0\/send$/)
    expect(init.method).toBe('POST')
    const headers = new Headers(init.headers)
    expect(headers.get('Idempotency-Key')).toBe('send-key-1')
    expect(headers.has('X-Line-Harness-Source')).toBe(false)
    expect(JSON.parse(init.body)).toEqual(input)
  })

  it('予約した送信（自動で出る）も手動の印を付けない', async () => {
    const fetch = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetch)
    await api.chats.schedule('friend-0', { ...attachmentSendInput(attachment), scheduledAt: '2026-10-09T00:00:00.000Z' }, 'sch-key')
    const [url, init] = fetch.mock.calls[0]
    expect(String(url)).toMatch(/\/api\/chats\/friend-0\/schedule$/)
    expect(new Headers(init.headers).has('X-Line-Harness-Source')).toBe(false)
  })

  it('受信箱の画面は送信を受信箱の口（api.chats.send / sendCombined）だけで行い、Proxy を呼ばない', () => {
    const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app', 'chats', 'page.tsx'), 'utf8')
    expect(page).toContain('api.chats.send(sendingChatId')
    expect(page).not.toMatch(/line-proxy|\/v2\/bot\/message\/push/)
  })
})
