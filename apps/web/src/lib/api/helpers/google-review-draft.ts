import { fetchApi } from '../../api'

export type GoogleReviewDraftOptions = {
  mode?: 'generate' | 'shorten' | 'polite'
  replyDraft?: string
}

/** Editing a draft stays separate from the existing one-click generate action. */
export function generateGoogleReviewDraft(accountId: string, id: string, options: GoogleReviewDraftOptions = {}) {
  const query = new URLSearchParams({ account_id: accountId })
  return fetchApi<{ success: true; draft: string; aiGenerated: true; generatedAt: string }>(
    `/api/restaurant-test/google/reviews/${encodeURIComponent(id)}/draft/generate?${query}`,
    { method: 'POST', body: JSON.stringify(options) },
  )
}
