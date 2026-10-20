
/** 公開run1件。版の要約・状態・試行に使ったLINE ID・最終エラー。 */
export type RichMenuPublishRun = {
  versionNumber?: number | null
  id: string
  status: 'running' | 'succeeded' | 'failed'
  lastErrorCode: string | null
  idempotencyKey: string
  requestedByStaffId: string
  createdAt: string
  updatedAt: string
  version: {
    name: string | null
    chatBarText: string | null
    pageCount: number | null
    /** その版が「誰に出る版」だったか。読めないスナップショットでは null。 */
    isDefaultForAll: boolean | null
    targetingEnabled: boolean | null
  }
  pages: Array<{
    pageId: string
    orderIndex: number
    newRichMenuId: string
    oldRichMenuId: string | null
  }>
}
