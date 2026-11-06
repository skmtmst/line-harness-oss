export interface UserRowData {
  identityKey: string
  identityKeyKind: 'url_token' | 'uid' | 'solo'
  displayName: string | null
  pictureUrl: string | null
  accounts: Array<{
    accountId: string
    accountName: string
    lineUserId: string
    isFollowing: boolean
    joinedAt: string
    friendId: string
  }>
  xUsername: string | null
  emails: string[]
  phones: string[]
  lastActivityAt: string
  isDuplicate: boolean
}
