import { fetchApi } from '@/lib/api'

type SenderState = { senderId: string | null; sender: { name: string } | null; sentByStaffId: string | null; sentByStaffName: string | null; correctionOfBroadcastId: string | null; correctionReason: string | null; senderStale: boolean; version: number; testMode: boolean }
type Result<T> = { success: true; data: T }
const path = (id: string) => `/api/broadcasts/${encodeURIComponent(id)}`
export const broadcastCorrectionApi = {
  getSender: (id: string) => fetchApi<Result<SenderState>>(`${path(id)}/sender`),
  setSender: (id: string, senderId: string | null, expectedVersion: number) => fetchApi<Result<{version: number}>>(`${path(id)}/sender`, {
    method: 'PUT', body: JSON.stringify({ senderId, expectedVersion }),
  }),
  create: (id: string, key: string) => fetchApi<Result<{ broadcastId: string; testMode: true }>>(`${path(id)}/correction`, {
    method: 'POST', headers: { 'Idempotency-Key': key }, body: '{}',
  }),
}
