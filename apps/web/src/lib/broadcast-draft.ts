export interface BroadcastDraftSession {
  accountId: string | null
  draftId: string | null
  createKey: string
}

type SaveResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; details?: Record<string, string[]> }

interface BroadcastDraftClient<T, P> {
  create: (payload: P, options: { idempotencyKey: string }) => Promise<SaveResponse<T>>
  update: (id: string, payload: P) => Promise<SaveResponse<T>>
}

export function newBroadcastDraftSession(
  accountId: string | null = null,
  createKey: string = crypto.randomUUID(),
): BroadcastDraftSession {
  return { accountId, draftId: null, createKey }
}

/**
 * テスト送信と最終予約で同じ下書きを使う。
 * アカウントが変わった場合だけ、別の冪等キーと下書きへ切り替える。
 */
export async function persistBroadcastDraft<T extends { id: string }, P>(
  current: BroadcastDraftSession,
  accountId: string | null,
  payload: P,
  client: BroadcastDraftClient<T, P>,
  createKey: () => string = () => crypto.randomUUID(),
): Promise<{ session: BroadcastDraftSession; broadcast: T }> {
  const session = current.accountId === accountId
    ? current
    : newBroadcastDraftSession(accountId, createKey())

  if (session.draftId) {
    const updated = await client.update(session.draftId, payload)
    if (!updated.success) throw new Error(updated.error ?? '下書きを保存できませんでした')
    return { session, broadcast: updated.data }
  }

  const created = await client.create(payload, { idempotencyKey: session.createKey })
  if (!created.success) throw new Error(created.error ?? '下書きを保存できませんでした')
  return {
    session: { ...session, draftId: created.data.id },
    broadcast: created.data,
  }
}
