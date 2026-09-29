import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PAGE = readFileSync(join(import.meta.dirname, 'webhook-interactions.tsx'), 'utf8')
const HOST = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8')
const NEW_PAGE = readFileSync(join(import.meta.dirname, 'new', 'page.tsx'), 'utf8')
const MOCK = readFileSync(join(import.meta.dirname, '..', '..', '..', '..', '..', 'scripts', 'visual-qa', 'mock-api.mjs'), 'utf8')

describe('点検・軽 第7便外部連携(#585)', () => {
  it('秘密値づくりは1か所に寄せる(#506 軽)', () => {
    expect(HOST).toContain("import { MIN_SECRET_LENGTH, generateSecret } from './secret'")
    expect(NEW_PAGE).toContain("import { MIN_SECRET_LENGTH, generateSecret } from '../secret'")
    expect(HOST).not.toContain('function generateSecret(')
    expect(NEW_PAGE).not.toContain('function generateSecret(')
  })

  it('やり直し可否は手元の保存値で決めない(#506 軽)', () => {
    expect(PAGE).toContain('api.staff.me()')
    expect(PAGE).not.toContain("localStorage.getItem('lh_staff_role')")
  })

  it('目視確認の符号は本物の形に寄せる(#506 軽)', () => {
    for (const code of ['order.created', 'friend.added', 'incoming_webhook.reservation', 'incoming_webhook.survey']) {
      expect(MOCK, `${code} が目視確認に無い`).toContain(`eventType: '${code}'`)
    }
    expect(MOCK).not.toContain("eventType: '注文が確定したとき'")
    expect(PAGE).toContain("'inventory.low': '在庫が少なくなったとき'")
    expect(PAGE).toContain("'shipment.completed': '発送が完了したとき'")
  })

  it('直書きの灰色を設計トークンに寄せる(#506 軽)', () => {
    for (const raw of ['text-gray-900', 'border-gray-300', 'text-red-600', 'bg-white']) {
      expect(HOST, `${raw} が残っている`).not.toContain(raw)
    }
  })
})
