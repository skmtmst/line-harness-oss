import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'

let fetchApi: typeof import('./api').fetchApi
let ApiError: typeof import('./api').ApiError
let extractApiErrorMessage: typeof import('./api').extractApiErrorMessage
let extractApiErrorCode: typeof import('./api').extractApiErrorCode
let extractApiErrorData: typeof import('./api').extractApiErrorData
let eventsApi: typeof import('./api').eventsApi
let webinarApi: typeof import('./api').webinarApi
let api: typeof import('./api').api

beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'https://worker.example.com'
  ;({
    fetchApi,
    ApiError,
    extractApiErrorMessage,
    extractApiErrorCode,
    extractApiErrorData,
    eventsApi,
    webinarApi,
    api,
  } = await import('./api'))
})

describe('api.nenCampaigns.createColumn', () => {
  it('sends only the selected account query and the public create fields', async () => {
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: { id: 'column-1' } }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchSpy)

    await api.nenCampaigns.createColumn('account/a', {
      title: '鹿肉の選び方',
      category: '食事',
      excerpt: '原材料表示の基本',
      articleUrl: 'https://example.com/columns/guide',
      imageUrl: null,
      publishedAt: null,
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'https://worker.example.com/api/nen-campaigns/columns?lineAccountId=account%2Fa',
    )
    const init = fetchSpy.mock.calls[0]?.[1]
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      title: '鹿肉の選び方',
      category: '食事',
      excerpt: '原材料表示の基本',
      articleUrl: 'https://example.com/columns/guide',
      imageUrl: null,
      publishedAt: null,
    })
  })
})

describe('webinarApi notifications', () => {
  it('設定保存とテスト送信を専用APIへ渡す', async () => {
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchSpy)
    const input = {
      registrationEnabled: true,
      dayBeforeEnabled: true,
      dayBeforeTime: '20:00',
      hourBeforeEnabled: true,
      hourBeforeMinutes: 60,
      startEnabled: true,
      missedEnabled: true,
      missedTime: '10:00',
      completedEnabled: true,
    }

    await webinarApi.saveNotifications('webinar/1', input)
    await webinarApi.testNotifications('webinar/1')

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'https://worker.example.com/api/webinars/webinar/1/notifications',
    )
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify(input),
    })
    expect(fetchSpy.mock.calls[1]?.[0]).toBe(
      'https://worker.example.com/api/webinars/webinar/1/notifications/test',
    )
    expect(fetchSpy.mock.calls[1]?.[1]).toMatchObject({ method: 'POST' })
  })
})

describe('api.affiliates.paymentSummaries', () => {
  it('選択中のLINE公式アカウントを必ずクエリへ含める', async () => {
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: [] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchSpy)

    await api.affiliates.paymentSummaries('account/1')

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'https://worker.example.com/api/affiliate-payments?lineAccountId=account%2F1',
    )
  })
})

describe('api.mileage reward draft contract', () => {
  it('版IDつきのPATCHで保存し、確認ヘッダーを付けて公開する', async () => {
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: { id: 'reward/1' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchSpy)
    const draft = {
      name: '先行案内',
      rewardKind: 'early_access' as const,
      requiredMiles: 500,
      commonActionVersionId: 'action-version-1',
    }

    await api.mileage.createRewardDraft('reward/1', 'account 1')
    await api.mileage.saveRewardDraft('reward/1', 'account 1', 'draft-version-1', draft)
    await api.mileage.publishReward('reward/1', 'account 1')

    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      'https://worker.example.com/api/mileage/rewards/reward%2F1/draft',
      'https://worker.example.com/api/mileage/rewards/reward%2F1/draft',
      'https://worker.example.com/api/mileage/rewards/reward%2F1/publish',
    ])
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ accountId: 'account 1' }),
    })
    expect(fetchSpy.mock.calls[1]?.[1]).toMatchObject({
      method: 'PATCH',
      body: JSON.stringify({
        accountId: 'account 1',
        expectedVersionId: 'draft-version-1',
        draft,
      }),
    })
    expect(fetchSpy.mock.calls[2]?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        'X-Confirm-Irreversible': 'mileage-reward-publish',
      }),
    })
  })
})

describe('eventsApi.createSlots', () => {
  const slots = Array.from({ length: 900 }, (_, index) => ({
    starts_at: new Date(Date.UTC(2099, 0, 1, 0, index)).toISOString(),
    ends_at: new Date(Date.UTC(2099, 0, 1, 0, index + 1)).toISOString(),
    capacity: null,
  }))

  it('900 slots are posted sequentially in 400/400/100 chunks', async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      const sent = JSON.parse(init?.body as string) as { slots: unknown[] }
      return new Response(JSON.stringify({ items: sent.slots }), { status: 201 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const response = await eventsApi.createSlots('account', 'event', slots)

    expect(fetchSpy).toHaveBeenCalledTimes(3)
    expect(fetchSpy.mock.calls.map((call) => JSON.parse(call[1]?.body as string).slots.length)).toEqual([400, 400, 100])
    expect(response.items).toHaveLength(900)
  })

  it('reports how many slots were added when a later chunk fails', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: slots.slice(0, 400) }), { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(eventsApi.createSlots('account', 'event', slots)).rejects.toThrow('400件まで追加されました')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})

describe('api.friendAddRouting draft/test/publish contract', () => {
  const routing = {
    firstTime: { scenarioId: 'scenario-1', timing: 'immediate' as const, actions: [] },
    returning: {
      scenarioId: null,
      mode: 'same' as const,
      startPosition: 'beginning' as const,
      actions: [],
    },
    criteria: { firstTime: 'unfollow_count_zero' as const },
  }

  it('下書き・確認・競合・テストを同じLINEアカウントに紐づける', async () => {
    const spy = vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: {} }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', spy)

    await api.friendAddRouting.getDraft('account 1')
    await api.friendAddRouting.saveDraft('account 1', routing)
    await api.friendAddRouting.validateDraft('account 1')
    await api.friendAddRouting.conflicts('account 1')
    await api.friendAddRouting.testDraft('account 1', 'friend-1')

    expect(spy.mock.calls.map(([url]) => url)).toEqual([
      'https://worker.example.com/api/friend-add-routing/draft?account_id=account%201',
      'https://worker.example.com/api/friend-add-routing/draft?account_id=account%201',
      'https://worker.example.com/api/friend-add-routing/validate?account_id=account%201',
      'https://worker.example.com/api/friend-add-routing/conflicts?account_id=account%201',
      'https://worker.example.com/api/friend-add-routing/draft/test?account_id=account%201',
    ])
    expect(spy.mock.calls[1][1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ routing }),
    })
    expect(spy.mock.calls[4][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ friendId: 'friend-1' }),
    })
  })

  it('公開要求に操作の識別キーを付ける', async () => {
    const spy = vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: {} }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', spy)

    await api.friendAddRouting.publish('account-1', 'publish-key-00000001')

    expect(spy).toHaveBeenCalledWith(
      'https://worker.example.com/api/friend-add-routing/publish?account_id=account-1',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'Idempotency-Key': 'publish-key-00000001',
        }),
      }),
    )
  })
})

describe('api.actionScores rule contract', () => {
  const configuration = {
    rules: [{
      id: 'rule-1',
      name: 'リンククリック',
      eventType: 'link_clicked',
      source: 'tracked_link',
      operation: 'delta' as const,
      value: 5,
      frequency: { kind: 'per_subject_per_day' as const, limit: 1 },
      sameSourceEventOnce: true as const,
      validFrom: null,
      validUntil: null,
      enabled: true,
    }],
    bands: { min: 0, max: 100, normalMin: 30, highMin: 70 },
  }

  it('下書き・試験・公開・停止を選択中のLINEアカウントへ送る', async () => {
    const spy = vi.fn(async () => new Response(
      JSON.stringify({ success: true, data: {} }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', spy)

    await api.actionScores.rules('account 1')
    await api.actionScores.saveDraft({
      accountId: 'account 1',
      expectedDraftVersionId: null,
      configuration,
    })
    await api.actionScores.testRules({
      accountId: 'account 1',
      configuration,
      currentScore: 10,
      eventType: 'link_clicked',
      source: 'tracked_link',
    })
    await api.actionScores.publishRules({ accountId: 'account 1', draftVersionId: 'draft-1' })
    await api.actionScores.stopRules('account 1')

    expect(spy.mock.calls.map(([url]) => url)).toEqual([
      'https://worker.example.com/api/action-scores/rules?accountId=account%201',
      'https://worker.example.com/api/action-scores/rules/draft',
      'https://worker.example.com/api/action-scores/rules/test',
      'https://worker.example.com/api/action-scores/rules/publish',
      'https://worker.example.com/api/action-scores/rules/stop',
    ])
    expect(spy.mock.calls[3]?.[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        'X-Confirm-Irreversible': 'action-score-rules-publish',
      }),
    })
    expect(JSON.parse(String(spy.mock.calls[4]?.[1]?.body))).toEqual({ accountId: 'account 1' })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extractApiErrorMessage', () => {
  it('400 では error を優先して取り出す', () => {
    expect(extractApiErrorMessage(JSON.stringify({ error: '入力してください' }), 400)).toBe(
      '入力してください',
    )
  })

  it('400 で error が無ければ message を使う', () => {
    expect(extractApiErrorMessage(JSON.stringify({ message: '権限がありません' }), 400)).toBe(
      '権限がありません',
    )
  })

  it('JSON でない本文は表示に使わない', () => {
    expect(extractApiErrorMessage('<html>internal details</html>', 400)).toBe('')
  })

  it('空の本文を許容する', () => {
    expect(extractApiErrorMessage('', 400)).toBe('')
  })

  it('error が文字列でない場合は使わない', () => {
    expect(extractApiErrorMessage(JSON.stringify({ error: { code: 500 } }), 400)).toBe('')
  })

  // 表示してよいのは、worker が自分で検証して返した 400 だけ。
  it.each([401, 403, 404, 409, 429, 500, 502, 503])(
    '%i の本文は内部情報を含みうるため表示しない',
    (status) => {
      const body = JSON.stringify({ error: 'D1_ERROR: no such table: rich_menu_groups' })
      expect(extractApiErrorMessage(body, status)).toBe('')
    },
  )
})

describe('extractApiErrorCode', () => {
  it('409や422でもsnake_caseの機械コードだけを取り出す', () => {
    expect(extractApiErrorCode(JSON.stringify({ error: 'slot_conflict' }))).toBe('slot_conflict')
    expect(extractApiErrorCode(JSON.stringify({ error: 'slot_not_available' }))).toBe('slot_not_available')
    expect(extractApiErrorCode(JSON.stringify({
      code: 'common_var_delete_blocked',
      error: '使用先から外してください',
    }))).toBe('common_var_delete_blocked')
    expect(extractApiErrorCode(JSON.stringify({
      code: 'rich_menu_delete_blocked',
      error: '削除する前に確認してください',
    }))).toBe('rich_menu_delete_blocked')
    expect(extractApiErrorCode(JSON.stringify({
      code: 'media_delete_blocked',
      error: '先に使用先から外してください',
    }))).toBe('media_delete_blocked')
  })

  it('内部文言・HTML・文字列以外はコードとして受け取らない', () => {
    expect(extractApiErrorCode(JSON.stringify({ error: 'D1_ERROR: no such table' }))).toBeUndefined()
    expect(extractApiErrorCode(JSON.stringify({ code: 'COMMON_VAR_IN_USE' }))).toBeUndefined()
    expect(extractApiErrorCode(JSON.stringify({ code: 'STALE_PERSON' }))).toBeUndefined()
    expect(extractApiErrorCode(JSON.stringify({ code: 'D1_ERROR: no such table' }))).toBeUndefined()
    expect(extractApiErrorCode('<html>proxy error</html>')).toBeUndefined()
    expect(extractApiErrorCode(JSON.stringify({ error: { code: 'slot_conflict' } }))).toBeUndefined()
  })
})

describe('extractApiErrorData', () => {
  it('409の最新状態を機械処理用に保持し、JSON以外は捨てる', () => {
    const impact = { canDelete: false, blockers: ['incoming_switches'] }
    expect(extractApiErrorData(JSON.stringify({ data: impact }))).toEqual(impact)
    const mediaImpact = { usageCount: 2, canDelete: false }
    expect(extractApiErrorData(JSON.stringify({ data: mediaImpact }))).toEqual(mediaImpact)
    const commonVarImpact = { blockingTotal: 2, canDelete: false }
    expect(extractApiErrorData(JSON.stringify({ data: commonVarImpact }))).toEqual(commonVarImpact)
    expect(extractApiErrorData('<html>proxy error</html>')).toBeUndefined()
  })
})

describe('fetchApi error response', () => {
  it('Worker の具体的な error を管理画面へ伝える', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: false,
          error: 'ページ「基本メニュー」のタップ領域1: 送信テキストを入力してください',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    ))

    await expect(fetchApi('/api/rich-menu-groups/example/publish', { method: 'POST' }))
      .rejects.toThrow('ページ「基本メニュー」のタップ領域1: 送信テキストを入力してください')
  })

  it('具体的な error を出しても status で分岐できる状態を保つ', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: '送信テキストを入力してください' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    ))

    // ApiError.status に依存している既存の呼び出し元を壊さないこと。
    await expect(fetchApi('/api/example', { method: 'POST' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
    })
    expect(new ApiError(401).message).toBe('API error: 401')
  })

  it('メディア削除409の最新影響を保持しても本文は利用者向けメッセージにしない', async () => {
    const impact = {
      usageCount: 2,
      canDelete: false,
      references: [{ name: '8月のお知らせ', state: 'available' }],
    }
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        success: false,
        code: 'media_delete_blocked',
        error: 'このファイルは2か所で使われています。先に使用先から外してください。',
        data: impact,
      }), { status: 409 }),
    ))

    await expect(fetchApi('/api/media/media-1?accountId=account-1', { method: 'DELETE' }))
      .rejects.toMatchObject({
        name: 'ApiError',
        status: 409,
        code: 'media_delete_blocked',
        message: 'API error: 409',
        data: impact,
      })
  })

  it('予期しない本文は表示せず status にフォールバックする', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('<html>internal details</html>', { status: 502 }),
    ))

    await expect(fetchApi('/api/example')).rejects.toThrow('API error: 502')
  })

  it('409の機械コードを保持しても本文は利用者向けメッセージにしない', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: 'slot_conflict' }), { status: 409 }),
    ))

    await expect(fetchApi('/api/booking/admin/bookings', { method: 'POST' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'slot_conflict',
      message: 'API error: 409',
    })
  })

  it('409の最新影響を画面の読み直し用に保持する', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        success: false,
        error: 'form_delete_changed',
        data: { revision: 5, submissionCount: 4 },
      }), { status: 409, headers: { 'Content-Type': 'application/json' } }),
    ))

    await expect(fetchApi('/api/forms/form-1/archive', { method: 'POST' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'form_delete_changed',
      data: { revision: 5, submissionCount: 4 },
      message: 'API error: 409',
    })
  })

  it('500の本文データは呼び出し元へ渡さない', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        error: 'D1_ERROR',
        data: { sql: 'SELECT secret FROM hidden' },
      }), { status: 500 }),
    ))

    await expect(fetchApi('/api/forms/form-1/archive', { method: 'POST' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      data: undefined,
    })
  })

  it('共通情報削除409の最新影響を保持しても本文は利用者向けメッセージにしない', async () => {
    const impact = {
      blockingTotal: 2,
      canDelete: false,
      items: [{ name: '営業時間のお知らせ', blocksDeletion: true }],
    }
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        success: false,
        code: 'common_var_delete_blocked',
        error: '2件で使用中のため削除できません',
        data: impact,
      }), { status: 409 }),
    ))

    await expect(fetchApi('/api/common-vars/common-var-1?accountId=account-1', { method: 'DELETE' }))
      .rejects.toMatchObject({
        name: 'ApiError',
        status: 409,
        code: 'common_var_delete_blocked',
        message: 'API error: 409',
        data: impact,
      })
  })

  it('409の最新状態は保持し、本文は利用者へ直接出さない', async () => {
    const impact = { canDelete: false, blockers: ['incoming_switches'] }
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        success: false,
        code: 'rich_menu_delete_blocked',
        error: '削除する前に、公開状態と使われている場所を確認してください',
        data: impact,
      }), { status: 409 }),
    ))

    await expect(fetchApi('/api/rich-menu-groups/example', { method: 'DELETE' }))
      .rejects.toMatchObject({
        name: 'ApiError',
        status: 409,
        code: 'rich_menu_delete_blocked',
        message: 'API error: 409',
        data: impact,
      })
  })

  it('500 の本文は JSON でも表示せず status にフォールバックする', async () => {
    // LINE API 失敗や未処理例外は 500 で返る。内部情報を管理画面へ出さない。
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(
        JSON.stringify({ success: false, error: 'LINE API 401: Invalid channel access token' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      ),
    ))

    await expect(fetchApi('/api/rich-menu-groups/example/publish', { method: 'POST' }))
      .rejects.toThrow('API error: 500')
  })

  it('認証・CSRF ヘッダーの付与は従来どおり維持される', async () => {
    const spy = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', spy)

    await fetchApi('/api/example', { method: 'POST' })

    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })
})
