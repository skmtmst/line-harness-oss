export interface BroadcastDraftSession {
  accountId: string | null
  draftId: string | null
  /** 下書きの今の版。作成・更新の応答から進める。送るときに必ず付ける。 */
  version: number | null
  createKey: string
}

type SaveResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; details?: Record<string, string[]> }

interface BroadcastDraftClient<T, P> {
  create: (payload: P, options: { idempotencyKey: string }) => Promise<SaveResponse<T>>
  update: (id: string, payload: P, expectedVersion: number) => Promise<SaveResponse<T>>
}

export function newBroadcastDraftSession(
  accountId: string | null = null,
  createKey: string = crypto.randomUUID(),
): BroadcastDraftSession {
  return { accountId, draftId: null, version: null, createKey }
}

/**
 * テスト送信と最終予約で同じ下書きを使う。
 * アカウントが変わった場合だけ、別の冪等キーと下書きへ切り替える。
 *
 * #772: 更新は保持している版を付けて送り、成功応答の版へ進める。
 * 版が分からない状態では送らず、古い版のまま送り直すこともしない。
 */
export async function persistBroadcastDraft<T extends { id: string; version?: number | null }, P>(
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
    if (session.version === null) {
      throw new Error('下書きの版が分からないため、読み直してください')
    }
    const updated = await client.update(session.draftId, payload, session.version)
    if (!updated.success) throw new Error(updated.error ?? '下書きを保存できませんでした')
    return {
      session: { ...session, version: updated.data.version ?? session.version },
      broadcast: updated.data,
    }
  }

  const created = await client.create(payload, { idempotencyKey: session.createKey })
  if (!created.success) throw new Error(created.error ?? '下書きを保存できませんでした')
  return {
    session: { ...session, draftId: created.data.id, version: created.data.version ?? null },
    broadcast: created.data,
  }
}
