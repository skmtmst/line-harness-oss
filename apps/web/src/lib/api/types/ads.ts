export type AdPlatform = {
  secretKeys?: string[]
  verifiedAt?: string | null
  id: string
  /** meta / x / google / tiktok */
  name: string
  displayName: string | null
  /** 鍵は先頭と末尾だけ残して伏せてある。 */
  config: Record<string, unknown>
  isActive: boolean
  lineAccountId: string | null
  createdAt: string
  updatedAt: string
}

export type AdConversionLog = {
  id: string
  adPlatformId: string
  friendId: string
  lineAccountId: string | null
  eventName: string
  clickId: string | null
  clickIdType: string | null
  status: string
  errorMessage: string | null
  createdAt: string
}
