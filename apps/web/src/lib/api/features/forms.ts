import { fetchApiBlob } from '../transport/download'
import { fetchApi } from '../transport/request'
import type { ApiResponse, FormSubmissionDetail, FormSubmissionPage, FormLayout } from '@line-crm/shared'
import type { FormDeleteImpact } from '../types/publication'

export const formsMethods = {
/** 回答フォーム。 */
  forms: {
    exportResponses: (formId: string, accountId: string) => fetchApiBlob(`/api/forms/${encodeURIComponent(formId)}/exports?account_id=${encodeURIComponent(accountId)}`, { method: 'POST', accountId }),
    submission: (formId: string, submissionId: string, accountId: string) =>
      fetchApi<ApiResponse<FormSubmissionDetail>>(
        `/api/forms/${encodeURIComponent(formId)}/submissions/${encodeURIComponent(submissionId)}?account_id=${encodeURIComponent(accountId)}`,
      ),
    submissions: (formId: string, accountId: string, params: { page?: number; limit?: number; query?: string; from?: string; to?: string; period?: 'this_month' | 'last_month' | 'all' } = {}) => {
      const query = new URLSearchParams({ account_id: accountId, page: String(params.page ?? 1), limit: String(params.limit ?? 20) })
      if (params.query) query.set('q', params.query)
      for (const key of ['from','to','period'] as const) if (params[key] !== undefined) query.set(key, params[key]!)
      return fetchApi<ApiResponse<FormSubmissionPage>>(
        `/api/forms/${encodeURIComponent(formId)}/submissions?${query}`,
      )
    },
    list: (accountId: string) =>
      fetchApi<ApiResponse<Array<{ id: string; name: string; description: string | null; isActive: boolean }>>>(
        `/api/forms?account_id=${encodeURIComponent(accountId)}`,
      ),
    get: (id: string, accountId: string) =>
      fetchApi<
        ApiResponse<{
          id: string
          name: string
          description: string | null
          fields: unknown
          /** ブロック・セクション・オプションの入れ物。古いフォームでも必ず入る */
          layout: FormLayout
          onSubmitTagId: string | null
          onSubmitMessageType: string | null
          onSubmitMessageContent: string | null
          isActive: boolean
          submitCount: number
          ogTitle: string | null
          ogDescription: string | null
          ogImageUrl: string | null
          /**
           * 編集の版(#723)。保存でそのまま送り返す。
           *
           * サーバは前からこれを返していたのに、この型が落としていたので
           * 画面が版を持てず、2人が同時に編集すると後勝ちで黙って上書き
           * されていた。型に無いものは、来ていないことに誰も気づけない。
           */
          contentRevision: number
          latestEdit?: {staffId:string;staffName:string;savedAt:string}|null
          /** お客さまに出している不変版。null は未公開。 */
          publishedVersionId: string | null
          /** 現在公開版の元になった編集版。 */
          publishedContentRevision: number | null
        }>
      >(`/api/forms/${id}?account_id=${encodeURIComponent(accountId)}`),
    create: (
      accountId: string,
      data: { name: string; description?: string | null; layout?: FormLayout },
    ) =>
      fetchApi<ApiResponse<{ id: string }>>('/api/forms', {
        method: 'POST',
        body: JSON.stringify({ ...data, accountId }),
      }),
    createDraft: (accountId: string, name?: string) =>
      fetchApi<ApiResponse<{ id: string; isActive: boolean }>>('/api/forms/drafts', {
        method: 'POST',
        body: JSON.stringify({ name, accountId }),
      }),
    /**
     * R230: フォーム全体を別IDの下書きとして複製する。質問・分岐・デザイン・
     * 受付設定を引き継ぎ、回答・公開状態・集計は引き継がない。複製は受付停止。
     */
    duplicate: (id: string, accountId: string, name?: string) =>
      fetchApi<ApiResponse<{ id: string; isActive: boolean }>>(
        `/api/forms/${id}/duplicate?account_id=${encodeURIComponent(accountId)}`,
        { method: 'POST', body: JSON.stringify({ name: name?.trim() ? name.trim() : undefined }) },
      ),
    update: (
      id: string,
      accountId: string,
      data: {
        name?: string
        description?: string | null
        fields?: unknown
        /**
         * 送ると fields もこちらから作り直される。
         * 予約のつまみは各ブロックのbooking.allowMenuSelection/requireApproval。
         */
        layout?: FormLayout
        onSubmitTagId?: string | null
        onSubmitMessageType?: string | null
        onSubmitMessageContent?: string | null
        isActive?: boolean
        ogTitle?: string | null
        ogDescription?: string | null
        ogImageUrl?: string | null
        /**
         * 確認した編集の版(#723)。**必須。**
         *
         * 省けるようにすると、省いた呼び出しが楽観ロックを丸ごと迂回する。
         * 受付停止のような1項目の更新も同じ口を通るので、例外を作らない。
         */
        expectedContentRevision: number
      },
    ) =>
      fetchApi<ApiResponse<{ id: string; contentRevision: number; updatedAt: string }>>(
        `/api/forms/${id}?account_id=${encodeURIComponent(accountId)}`,
        { method: 'PUT', body: JSON.stringify(data) },
      ),
    publish: (id: string, accountId: string, expectedContentRevision: number) =>
      fetchApi<ApiResponse<{
        id: string
        versionNumber: number
        contentRevision: number
        publishedAt: string
        replayed: boolean
      }>>(`/api/forms/${id}/publish?account_id=${encodeURIComponent(accountId)}`, {
        method: 'POST',
        body: JSON.stringify({ expectedContentRevision }),
      }),
    /**
     * P（公開前の試し）：試し合言葉を発行する。生の合言葉はこの応答でしか返らない。
     * 有効期限は24時間。試しの回答は集計に入らず、回答後の動作も動かない。
     */
    issueTestToken: (id: string, accountId: string) =>
      fetchApi<ApiResponse<{ token: string; expiresAt: string }>>(
        `/api/forms/${id}/test-token?account_id=${encodeURIComponent(accountId)}`,
        { method: 'POST', body: JSON.stringify({}) },
      ),
    deleteImpact: (id: string, accountId: string) =>
      fetchApi<ApiResponse<FormDeleteImpact>>(
        `/api/forms/${id}/delete-impact?account_id=${encodeURIComponent(accountId)}`,
      ),
    archive: (id: string, accountId: string, expectedRevision: number) =>
      fetchApi<ApiResponse<{
        status: 'archived'
        archivedAt: string
        retainedSubmissionCount: number
        retainedOpenCount: number
        retainedReferenceCount: number
        answerUrlUnavailable: true
      }>>(`/api/forms/${id}/archive?account_id=${encodeURIComponent(accountId)}`, {
        method: 'POST',
        body: JSON.stringify({ expectedRevision }),
      }),
    remove: (id: string, accountId: string, expectedRevision?: number) =>
      fetchApi<ApiResponse<null>>(
        `/api/forms/${id}?account_id=${encodeURIComponent(accountId)}${
          expectedRevision == null ? '' : `&expected_revision=${encodeURIComponent(String(expectedRevision))}`
        }`,
        { method: 'DELETE' },
      ),
    /*
     * B 元に戻す: 保管の取り消し。戻した直後は受付停止のまま。
     * 画面の Toast から呼ぶ想定（各機能の担当が配線する）。
     */
    unarchive: (id: string, accountId: string, expectedRevision: number) =>
      fetchApi<ApiResponse<{
        status: 'active'
        revision: number
        isActive: boolean
      }>>(`/api/forms/${id}/unarchive?account_id=${encodeURIComponent(accountId)}`, {
        method: 'POST',
        body: JSON.stringify({ expectedRevision }),
      }),
  },
}
