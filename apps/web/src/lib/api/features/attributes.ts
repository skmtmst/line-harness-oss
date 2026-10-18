import { fetchApi } from '../transport/request'
import type {
  ApiResponse,
  Tag,
  TagCsvImportInputRow,
  TagCsvImportPreview,
  TagCsvImportResult,
  FriendField,
  FriendFieldListSummary,
  FriendFieldType,
  SupportMark,
  Folder,
  TagGroup,
} from '@line-crm/shared'
import type {
  TagDeleteImpact,
  TagDefinition,
  TagDependencies,
  SaveTagDefinition,
  TagRetroactivePreview,
  FriendFieldMigrationPreview,
  FriendFieldMigrationRun,
  SupportMarkListItem,
  SaveSupportMarkAutomationRule,
  SupportMarkAutomationRule,
  SupportMarkArchiveImpact,
} from '../types/attributes'
import type { FetchApiOptions } from '../types/transport'

export const attributesMethods = {
  tags: {
    /** withCounts で friendCount 付き (JOIN 集計 — タグ管理ページ用)。 */
    list: (params?: { withCounts?: boolean; accountId?: string | null }) => {
      const query = new URLSearchParams()
      if (params?.withCounts) query.set('withCounts', '1')
      if (params?.accountId) query.set('lineAccountId', params.accountId)
      const suffix = query.size > 0 ? `?${query.toString()}` : ''
      return fetchApi<ApiResponse<Tag[]>>(`/api/tags${suffix}`)
    },
    /** CSVを保存せずに検査し、行ごとの扱いを返す。 */
    importPreview: (rows: TagCsvImportInputRow[]) =>
      fetchApi<ApiResponse<TagCsvImportPreview>>('/api/tags/import/preview', {
        method: 'POST',
        body: JSON.stringify({ rows }),
      }),
    /** 保存直前に再検査し、登録できる行だけをまとめて作る。 */
    importCsv: (rows: TagCsvImportInputRow[]) =>
      fetchApi<ApiResponse<TagCsvImportResult>>('/api/tags/import', {
        method: 'POST',
        body: JSON.stringify({ rows }),
      }),
    /**
     * 削除する前に、何が失われるかを数えて返す（PR #381）。
     *
     * **DELETE 側にはまだ強制停止が入っていない。** 止めるのは画面の役目で、
     * `canDelete: false` のときにボタンを押せなくする。取れなかったときも
     * 押せなくする（「参照0件」と読み違えて消させないため）。
     * 権限は owner / admin。
     */
    deleteImpact: (id: string) =>
      fetchApi<ApiResponse<TagDeleteImpact>>(`/api/tags/${id}/delete-impact`),
    definition: (id: string, accountId: string) =>
      fetchApi<ApiResponse<TagDefinition>>(
        `/api/tags/${id}?lineAccountId=${encodeURIComponent(accountId)}&withActions=1`,
      ),
    dependencies: (id: string, accountId: string) =>
      fetchApi<ApiResponse<TagDependencies>>(
        `/api/tags/${id}/dependencies?lineAccountId=${encodeURIComponent(accountId)}`,
      ),
    createDefinition: (accountId: string, data: SaveTagDefinition) =>
      fetchApi<ApiResponse<TagDefinition>>('/api/tags', {
        method: 'POST',
        /*
         * D012: 作る要求ごとの見分け札。二度押し・通信の再送で同じタグが
         * 2つできないよう、呼び出し側は毎回新しい札を付ける（公開系の
         * publish・revert と同じ渡し方）。
         */
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          lineAccountId: accountId,
          ...data,
          automationDraft: { actions: data.actions },
        }),
      }),
    updateDefinition: (
      id: string,
      accountId: string,
      expectedVersion: number,
      data: SaveTagDefinition & {
        automationId?: string | null
        automationDraftVersion?: string | null
        /** 遡及実行の前に /retroactive-preview で受け取った引き換え券（N-047）。 */
        previewToken?: string
      },
      /** M956: 応答消失後の再送用。同じ内容の再送では同じ値を送り、成功したら捨てる。 */
      idempotencyKey?: string,
    ) => fetchApi<ApiResponse<TagDefinition & { queued: number; replayed: boolean }>>(`/api/tags/${id}`, {
      method: 'PATCH',
      ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
      body: JSON.stringify({ lineAccountId: accountId, expectedVersion, ...data }),
    }),
    /**
     * 保管済み(archived)タグの訂正専用（Issue #710）。名前と説明だけ送る。
     * `updateDefinition` は `SaveTagDefinition` の必須項目（マイル・連動
     * アクションなど）を要求するため、archived タグでは使えない。
     * サーバ側（`updateTagDefinition`）も archived では名前と説明以外の
     * 実質的な変更を拒否するので、ここで送らなくても保護は効く。
     */
    updateArchivedNameAndDescription: (
      id: string,
      accountId: string,
      expectedVersion: number,
      data: { name?: string; description?: string | null },
      /** M956: 応答消失後の再送用。同じ内容の再送では同じ値を送り、成功したら捨てる。 */
      idempotencyKey?: string,
    ) => fetchApi<ApiResponse<TagDefinition & { queued: number; replayed: boolean }>>(`/api/tags/${id}`, {
      method: 'PATCH',
      ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
      body: JSON.stringify({ lineAccountId: accountId, expectedVersion, ...data }),
    }),
    // 色は受け取らない。印の色はフォルダ（tagGroups）に付く。
    create: (data: { name: string; groupId?: string | null; lineAccountId?: string }) =>
      fetchApi<ApiResponse<Tag>>('/api/tags', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    /**
     * 一覧に出すか(★)だけを変える(#715)。版付き必須。名前の変更は
     * `updateDefinition` を使う。タグ自身は色を持たない（色は分類に付ける）。
     */
    update: (id: string, data: { lineAccountId: string | null; expectedVersion: number; isStarred: boolean }) =>
      fetchApi<ApiResponse<Tag>>(`/api/tags/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    /** 並び順をまとめて書く。渡した順に 0,1,2… が振られる。 */
    reorder: (ids: string[]) =>
      fetchApi<ApiResponse<{ updated: number }>>('/api/tags/reorder', {
        method: 'PATCH',
        body: JSON.stringify({ ids }),
      }),
    /** 所属する親分類を変える。null で未分類に戻す。 */
    setGroup: (id: string, groupId: string | null) =>
      fetchApi<ApiResponse<Tag>>(`/api/tags/${id}/group`, {
        method: 'PATCH',
        body: JSON.stringify({ groupId }),
      }),
    updateMileage: (id: string, data: {
      rewardMiles: number
      referralRewardMiles: number
      multiplierBps: number | null
      multiplierPriority: number
      /** true のときだけ、すでにこのタグが付いている人へ遡及する。 */
      applyToExisting?: boolean
      /** 遡及実行の前に /retroactive-preview で受け取った引き換え券（N-047）。 */
      previewToken?: string
    }) =>
      fetchApi<ApiResponse<{ tag: Tag; queued: number }>>(`/api/tags/${id}/mileage`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    /**
     * 遡及実行の前に対象をサーバー側で数える（N-047）。
     * 返す previewToken を applyToExisting の実行へそのまま渡す。
     */
    retroactivePreview: (id: string, accountId: string, mileage?: { self?: number; referrer?: number }) =>
      fetchApi<ApiResponse<TagRetroactivePreview>>(
        `/api/tags/${id}/retroactive-preview`,
        {
          method: 'POST',
          body: JSON.stringify({ lineAccountId: accountId, ...(mileage ? { mileage } : {}) }),
        },
      ),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/tags/${id}`, { method: 'DELETE' }),
    restore: (id: string, accountId: string, expectedVersion: number) =>
      fetchApi<ApiResponse<{ restored: true; version: number }>>(`/api/tags/${encodeURIComponent(id)}/restore?lineAccountId=${encodeURIComponent(accountId)}`, {
        method: 'POST', body: JSON.stringify({ expectedVersion }),
      }),
    archive: (id: string, accountId: string, data: {
      expectedVersion: number
      impactRevision: string
      replacementTagId?: string | null
    }, idempotencyKey: string) => fetchApi<ApiResponse<{
      archived: true
      replacedFriendCount: number
    }>>(`/api/tags/${id}/archive?lineAccountId=${encodeURIComponent(accountId)}`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(data),
    }),
  },
/**
   * タグの親分類。経路が /api/tag-groups なのは /api/tags/:id と
   * 衝突させないため（/api/tags/groups だと :id に食われる）。
   */
  /**
   * 友だち情報欄。
   *
   * 差し込み名（fieldKey）と種類は作成時にしか決められない。後から変えると
   * 既存の値の意味が変わったり、テンプレートの差し込みが空になったりする。
   */
  friendFields: {
    list: (accountId: string, params?: { folderId?: string; withUsage?: boolean }, options?: FetchApiOptions) => {
      const q = new URLSearchParams()
      q.set('lineAccountId', accountId)
      if (params?.folderId) q.set('folderId', params.folderId)
      if (params?.withUsage) q.set('withUsage', '1')
      const query = q.toString()
      return fetchApi<ApiResponse<FriendField[]>>(
        `/api/friend-fields${query ? `?${query}` : ''}`,
        options,
      )
    },
    stats: (accountId: string) =>
      fetchApi<ApiResponse<FriendFieldListSummary>>(
        `/api/friend-fields-stats?lineAccountId=${encodeURIComponent(accountId)}`,
      ),
    /**
     * 値は変更せず、種類を変えた場合に確認が要る友だちだけを返す。
     * targetFieldId を渡すと実行へ使える previewToken・期限が返る
     * （渡さない場合は件数だけの読み取り専用確認）。
     */
    migrationPreview: (id: string, accountId: string, options: { targetType?: FriendFieldType; targetFieldId?: string }) =>
      fetchApi<ApiResponse<FriendFieldMigrationPreview>>(
        `/api/friend-fields/${id}/migration-preview?lineAccountId=${encodeURIComponent(accountId)}`,
        { method: 'POST', body: JSON.stringify(options) },
      ),
    /**
     * 事前確認で発行された previewToken で本移行を実行する。
     * Idempotency-Key は確認ごとに1つだけ発行し、再送・二重実行を
     * サーバー側で同じ実行に束ねる。
     */
    migrationExecute: (id: string, accountId: string, previewToken: string, idempotencyKey: string) =>
      fetchApi<ApiResponse<{ runId: string }>>(
        `/api/friend-fields/${id}/migrations?lineAccountId=${encodeURIComponent(accountId)}`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({ previewToken }),
        },
      ),
    /** 実行の状態と失敗した行を確認する。 */
    migrationRun: (runId: string, accountId: string) =>
      fetchApi<ApiResponse<FriendFieldMigrationRun>>(
        `/api/field-migrations/${runId}?lineAccountId=${encodeURIComponent(accountId)}`,
      ),
    /**
     * R515: 応答だけ失った再試行で二重に作らないため、要求キーを付ける。
     * 同じ作成のやり直しは同じキーを送り、内容を変えたら新しいキーにする。
     */
    create: (accountId: string, data: {
      name: string
      fieldKey: string
      type: FriendFieldType
      folderId?: string | null
      options?: string[] | null
      /* R139: 複数選択の既定値は選択肢名の配列で渡す（サーバーがIDへ直す）。 */
      defaultValue?: string | string[] | null
      ecFieldPath?: string | null
      ecIsMaster?: boolean
      isPersonal?: boolean
      isStarred?: boolean
      displayOrder?: number
    }, idempotencyKey?: string) =>
      fetchApi<ApiResponse<FriendField>>(
        `/api/friend-fields?lineAccountId=${encodeURIComponent(accountId)}`,
        {
        method: 'POST',
        ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
        body: JSON.stringify(data),
        },
      ),
    update: (
      id: string,
      accountId: string,
      data: Partial<
        Omit<
          Pick<
            FriendField,
            | 'name'
            | 'folderId'
            | 'defaultValue'
            | 'isPersonal'
            | 'isStarred'
            | 'displayOrder'
            | 'ecFieldPath'
            | 'ecIsMaster'
            | 'version'
          >,
          'defaultValue'
        >
      > & {
        options?: string[] | null
        /* R139: 複数選択の既定値は選択肢名の配列で渡す（サーバーがIDへ直す）。 */
        defaultValue?: string | string[] | null
      },
    ) =>
      fetchApi<ApiResponse<FriendField>>(`/api/friend-fields/${id}?lineAccountId=${encodeURIComponent(accountId)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    /**
     * 動かせる行だけの新しい順を1回で保存する（#1014 ATTR-02/03/04）。
     * 隠れた行と共通項目の位置はサーバー側で保つ。
     */
    reorder: (accountId: string, ids: string[]) =>
      fetchApi<ApiResponse<{ updated: number }>>(
        `/api/friend-fields/reorder?lineAccountId=${encodeURIComponent(accountId)}`,
        { method: 'PATCH', body: JSON.stringify({ ids }) },
      ),
    /** 値が入っている項目は409。物理削除せず移行する。 */
    delete: (id: string, accountId: string) =>
      fetchApi<ApiResponse<null>>(
        `/api/friend-fields/${id}?lineAccountId=${encodeURIComponent(accountId)}`,
        { method: 'DELETE' },
      ),
    /** 1人ぶんの全項目と値。個人情報は役割で絞られる。 */
    forFriend: (friendId: string, options?: FetchApiOptions) =>
      fetchApi<ApiResponse<{ items: FriendField[]; hiddenPersonalCount: number }>>(
        `/api/friends/${friendId}/fields`,
        options,
      ),
    /** まとめて更新。EC が正の項目は無視され warnings に理由が入る。 */
    saveForFriend: (friendId: string, values: Record<string, string | null>) =>
      fetchApi<ApiResponse<{ updated: number }> & { warnings?: string[] }>(
        `/api/friends/${friendId}/fields`,
        { method: 'PUT', body: JSON.stringify({ values }) },
      ),
    bulk: (data: { friendIds: string[]; fieldId: string; value: string | null; lineAccountId: string }) =>
      fetchApi<ApiResponse<{ updated: number }>>('/api/friend-fields/bulk', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
/** 対応マーク。友だちの対応状況を運用側の言葉で持つ。 */
  supportMarks: {
    list: (accountId: string, options?: FetchApiOptions & { includeArchived?: boolean }) =>
      fetchApi<ApiResponse<SupportMarkListItem[]>>(
        `/api/support-marks?lineAccountId=${encodeURIComponent(accountId)}${options?.includeArchived ? '&includeArchived=1' : ''}`,
        options,
      ),
    restore: (id: string, accountId: string, expectedVersion: number) =>
      fetchApi<ApiResponse<{ restored: true; version: number }>>(`/api/support-marks/${encodeURIComponent(id)}/restore?lineAccountId=${encodeURIComponent(accountId)}`, {
        method: 'POST', body: JSON.stringify({ expectedVersion }),
      }),
    /**
     * R512: 応答だけ失った再試行で二重に作らないため、要求キーを付ける。
     * 同じ作成のやり直しは同じキーを送り、内容を変えたら新しいキーにする。
     */
    create: (accountId: string, data: {
      name: string
      color?: string
      isDefault?: boolean
      autoOnInbound?: boolean
      displayOrder?: number
      automationRules?: SaveSupportMarkAutomationRule[]
    }, idempotencyKey?: string) =>
      fetchApi<ApiResponse<SupportMark>>(
        `/api/support-marks?lineAccountId=${encodeURIComponent(accountId)}`,
        {
        method: 'POST',
        ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
        body: JSON.stringify(data),
        },
      ),
    /**
     * R513: 読んだときの版（expectedVersion）を送り、ほかの担当者が
     * 先に変えていたら409で止める。版が無い呼び出しは従来どおり上書きする。
     */
    update: (
      id: string,
      accountId: string,
      data: Partial<Pick<SupportMark, 'name' | 'color' | 'isDefault' | 'autoOnInbound' | 'displayOrder'>> & {
        expectedVersion?: number
      },
    ) =>
      fetchApi<ApiResponse<SupportMark>>(
        `/api/support-marks/${id}?lineAccountId=${encodeURIComponent(accountId)}`,
        {
        method: 'PATCH',
        body: JSON.stringify(data),
        },
      ),
    /**
     * 動かせる行だけの新しい順を1回で保存する（#1014 ATTR-02/03/04）。
     * 共有マークへ行ごとのPATCHを送ると複製が起きるため、必ずこちらを使う。
     */
    reorder: (accountId: string, ids: string[]) =>
      fetchApi<ApiResponse<{ updated: number }>>(
        `/api/support-marks/reorder?lineAccountId=${encodeURIComponent(accountId)}`,
        { method: 'PATCH', body: JSON.stringify({ ids }) },
      ),
    /** 影響が確認時から変わっていない場合だけ、友だちを置換してマークを保管する。 */
    delete: (id: string, accountId: string, data: {
      replacementMarkId: string
      expectedImpact: {
        friendCount: number
        usedIn: NonNullable<SupportMark['usedIn']>
      }
    }) =>
      fetchApi<ApiResponse<{
        archived: true
        replacedFriendCount: number
        replacementMark: SupportMark
      }>>(
        `/api/support-marks/${id}?lineAccountId=${encodeURIComponent(accountId)}`,
        { method: 'DELETE', body: JSON.stringify(data) },
      ),
    setForFriend: (friendId: string, accountId: string, markId: string | null) =>
      fetchApi<ApiResponse<null>>(
        `/api/friends/${friendId}/support-mark?lineAccountId=${encodeURIComponent(accountId)}`,
        {
        method: 'PATCH',
        body: JSON.stringify({ markId }),
        },
      ),
    bulk: (friendIds: string[], accountId: string, markId: string | null) =>
      fetchApi<ApiResponse<{ updated: number }>>(
        `/api/friends/support-mark/bulk?lineAccountId=${encodeURIComponent(accountId)}`,
        {
        method: 'POST',
        body: JSON.stringify({ friendIds, markId }),
        },
      ),
    /*
      自動変更ルール。**まだ Worker に無い口を呼ぶことがある**（API は
      skmtmst/line-harness-oss#758）。呼び出し側は 404 を「未接続」として
      扱い、押しても何も起きない操作を並べない。
    */
    automationRules: (markId: string, accountId: string) =>
      fetchApi<ApiResponse<SupportMarkAutomationRule[]>>(
        `/api/support-marks/${markId}/automation-rules?lineAccountId=${encodeURIComponent(accountId)}`,
      ),
    createAutomationRule: (
      markId: string,
      accountId: string,
      data: SaveSupportMarkAutomationRule,
      idempotencyKey: string,
    ) => fetchApi<ApiResponse<SupportMarkAutomationRule>>(
      `/api/support-marks/${markId}/automation-rules?lineAccountId=${encodeURIComponent(accountId)}`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(data),
      },
    ),
    updateAutomationRule: (
      ruleId: string,
      accountId: string,
      expectedVersion: number,
      data: SaveSupportMarkAutomationRule,
    ) => fetchApi<ApiResponse<SupportMarkAutomationRule>>(
      `/api/support-mark-rules/${ruleId}?lineAccountId=${encodeURIComponent(accountId)}`,
      { method: 'PATCH', body: JSON.stringify({ ...data, expectedVersion }) },
    ),
    archiveAutomationRule: (ruleId: string, accountId: string, expectedVersion: number) =>
      fetchApi<ApiResponse<null>>(
        `/api/support-mark-rules/${ruleId}?lineAccountId=${encodeURIComponent(accountId)}`,
        { method: 'DELETE', body: JSON.stringify({ expectedVersion }) },
      ),
    archiveImpact: (markId: string, accountId: string) =>
      fetchApi<ApiResponse<SupportMarkArchiveImpact>>(
        `/api/support-marks/${markId}/archive-impact?lineAccountId=${encodeURIComponent(accountId)}`,
      ),
    archive: (
      markId: string,
      accountId: string,
      /* R180: 0人のときは置換先なし（null）で保管できる。 */
      data: { replacementMarkId: string | null; impactRevision: string; expectedVersion: number },
      idempotencyKey: string,
    ) => fetchApi<ApiResponse<{
      archived: true
      replacedFriendCount: number
      replacementMark: SupportMark | null
    }>>(`/api/support-marks/${markId}/archive?lineAccountId=${encodeURIComponent(accountId)}`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(data),
    }),
  },
/** 汎用フォルダ。一覧13画面で共通に使う。 */
  folders: {
    /**
     * `unfiledCount` は「未分類」タブと同じ母集団で数えた件数（#631）。
     * `kind` を渡さない、または件数の母集団が確立できていない種別
     * （#730）では省かれる（`undefined`）。**`0` と紛れないよう、
     * 呼び出し側は存在チェックしてから使うこと。**
     */
    list: (kind?: string, accountId?: string) =>
      fetchApi<ApiResponse<Folder[]> & { unfiledCount?: number }>(`/api/folders${kind ? `?kind=${kind}` : ''}${kind && accountId ? `&account_id=${encodeURIComponent(accountId)}` : ''}`),
    /** 色（#RRGGBB）はフォルダに付く。中身の印にこの色が出る。 */
    create: (data: { kind: string; name: string; parentId?: string | null; color?: string | null; accountId?: string | null }) =>
      fetchApi<ApiResponse<Folder>>('/api/folders', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: { name?: string; parentId?: string | null; displayOrder?: number; color?: string | null; expectedRevision?: number }, accountId?: string) =>
      fetchApi<ApiResponse<Folder>>(`/api/folders/${id}${accountId ? `?account_id=${encodeURIComponent(accountId)}` : ''}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    /** 中身は消えず未分類に戻る。子フォルダは一緒に消える。 */
    delete: (id: string, accountId?: string, expectedRevision?: number) => {
      const q=new URLSearchParams();if(accountId)q.set('account_id',accountId);if(expectedRevision!==undefined)q.set('expectedRevision',String(expectedRevision));
      return fetchApi<ApiResponse<null>>(`/api/folders/${encodeURIComponent(id)}${q.size?'?'+q:''}`, { method: 'DELETE' })
    },
    /**
     * 隣り合う2つのフォルダの並びを1回で入れ替える（V6R-S2-c）。
     * 以前の「PATCH を2回」は、1回目だけ成功すると同じ番号が2つ残った。
     */
    swapOrder: (id: string, withId: string, accountId?: string, expectedRevision?: number, withExpectedRevision?: number) =>
      fetchApi<ApiResponse<{ swapped: [string, string] }>>(`/api/folders/${encodeURIComponent(id)}/swap-order`, {
        method: 'POST',
        body: JSON.stringify({ withId, ...(accountId ? { accountId } : {}), ...(expectedRevision === undefined ? {} : {expectedRevision}), ...(withExpectedRevision === undefined ? {} : {withExpectedRevision}) }),
      }),
  },
  tagGroups: {
    list: (accountId?: string | null) => fetchApi<ApiResponse<TagGroup[]>>(
      `/api/tag-groups${accountId ? `?lineAccountId=${encodeURIComponent(accountId)}` : ''}`,
    ),
    /** 色（#RRGGBB）はこのフォルダに付く。属するタグの印に出る。 */
    create: (data: { name: string; sortOrder?: number; color?: string | null; accountId?: string | null }) =>
      fetchApi<ApiResponse<TagGroup>>('/api/tag-groups', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: { name?: string; sortOrder?: number; color?: string | null; accountId?: string | null }) =>
      fetchApi<ApiResponse<TagGroup>>(`/api/tag-groups/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    /** 消しても属していたタグは残り、未分類に戻る。 */
    delete: (id: string, accountId?: string | null) =>
      fetchApi<ApiResponse<null>>(
        `/api/tag-groups/${id}${accountId ? `?lineAccountId=${encodeURIComponent(accountId)}` : ''}`,
        { method: 'DELETE' },
      ),
  },
}
