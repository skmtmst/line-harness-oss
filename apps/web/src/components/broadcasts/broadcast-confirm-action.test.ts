import { expect, it, vi } from 'vitest'
import type { ApiBroadcast } from '@/lib/api'
import type { SendConfirmationPreview } from '@line-crm/shared'

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), get: vi.fn() }))
vi.mock('@/lib/api/helpers/gap1', () => ({ chatSafetyApi: { confirmBroadcast: mocks.confirm } }))
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), api: { broadcasts: { get: mocks.get } } }))
import { confirmBroadcastMessage } from './broadcast-confirm-action'

it('模擬の訂正は模擬指定と同じキーを付け、本送信の形で送らない', async () => {
  mocks.confirm.mockResolvedValue({ success: true }); mocks.get.mockResolvedValue({ success: true, data: { id: 'draft' } })
  const preview = { recipients: 2, expectedVersion: 3, testMode: true } as unknown as SendConfirmationPreview
  await confirmBroadcastMessage({ onSuccess: vi.fn(), scheduledAtIso: () => null, sendPreview: { state: 'ready', data: preview, broadcast: { id: 'draft' } as ApiBroadcast }, setConfirmOpen: vi.fn(), setError: vi.fn(), setPreviewSeq: vi.fn() })
  expect(mocks.confirm).toHaveBeenCalledWith('draft', { expectedVersion: 3, confirmedRecipientCount: 2, testMode: true }, 'simulation:draft:3')
})
