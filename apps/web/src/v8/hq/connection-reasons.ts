import type { AccountWithStats } from '@/contexts/account-context'

/**
 * 統括のアカウント：「要確認」の理由を、引っかかった確認ごとの言葉にする。
 * worker の一覧（`connection.issues`・`connection.tokenExpired`）から作る。
 * 英語の内部の文は出さない。秘密値は来ない（URL と状態だけ）。
 */
export type ConnectionReason = {
  /** カードの1行に出す短い言葉。 */
  short: string
  /** 設定の窓・title に出す全文（URL を含む）。 */
  detail: string
}

export const FALLBACK_REASON = 'LINE ID・接続状態を確かめてください'

type Issue = NonNullable<NonNullable<AccountWithStats['connection']>['issues']>[number]

function sameUrl(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  return a.trim().replace(/\/+$/, '') === b.trim().replace(/\/+$/, '')
}

function reasonOf(issue: Issue): ConnectionReason | null {
  switch (issue.kind) {
    case 'bot_info': {
      if (issue.httpStatus == null) {
        return { short: 'LINE に問い合わせできませんでした', detail: 'LINE に問い合わせできませんでした。時間をおいて「更新する」を押してください。' }
      }
      return {
        short: 'LINE のトークンが使えません',
        detail: 'LINE がこのアカウントのトークンを受け付けません。LINE Developers の Messaging API のトークンを確かめてください。',
      }
    }
    case 'token_refresh':
      return { short: 'LINE のトークンを更新できませんでした', detail: 'LINE のトークンを自動で更新できませんでした。Channel ID・Channel secret を確かめてください。' }
    case 'webhook_endpoint': {
      if (issue.result === 'unconfigured') {
        return {
          short: 'LINE に Webhook の URL が登録されていません',
          detail: `LINE に Webhook の URL が登録されていません。${issue.expectedUrl ? `この環境の URL：${issue.expectedUrl}` : ''}`,
        }
      }
      if (issue.webhookActive === false && (!issue.registeredUrl || !issue.expectedUrl || sameUrl(issue.registeredUrl, issue.expectedUrl))) {
        return { short: 'LINE で Webhook の利用がオフです', detail: 'LINE Developers で「Webhook の利用」がオフになっています。' }
      }
      const urls = `登録：${issue.registeredUrl ?? '—'}／この環境：${issue.expectedUrl ?? '—'}`
      const off = issue.webhookActive === false ? '。「Webhook の利用」もオフです' : ''
      return {
        short: `Webhook の URL がこの環境と違います（${urls}）`,
        detail: `LINE に登録された Webhook の URL がこの環境と違います（${urls}）${off}。`,
      }
    }
    case 'webhook_test':
      return {
        short: 'Webhook の接続テストが通りません',
        detail: `LINE からこの環境への Webhook の接続テストが通りませんでした${issue.httpStatus ? `（応答 ${issue.httpStatus}）` : ''}。`,
      }
    default:
      return null
  }
}

/** 要確認の理由。何も分からなければ空。 */
export function connectionReasons(account: AccountWithStats): ConnectionReason[] {
  const reasons: ConnectionReason[] = []
  if (account.connection?.tokenExpired) {
    reasons.push({ short: 'LINE のトークンの期限が切れています', detail: 'LINE のトークンの期限が切れています。自動の更新が止まっていないか確かめてください。' })
  }
  for (const issue of account.connection?.issues ?? []) {
    const reason = reasonOf(issue)
    if (reason) reasons.push(reason)
  }
  return reasons
}

/** カードの1行。理由が複数なら「ほか N 件」を足す。 */
export function connectionReasonLine(account: AccountWithStats): { text: string; title: string } {
  const reasons = connectionReasons(account)
  if (reasons.length === 0) return { text: FALLBACK_REASON, title: FALLBACK_REASON }
  const more = reasons.length > 1 ? `（ほか ${reasons.length - 1} 件）` : ''
  return { text: `${reasons[0].short}${more}`, title: reasons.map((reason) => reason.detail).join('\n') }
}

/** LINE ID の表示。LINE から @ 付きで来ても @ は1つだけにする。 */
export function lineHandle(account: Pick<AccountWithStats, 'basicId' | 'channelId'>): string {
  const raw = (account.basicId || account.channelId || '').trim().replace(/^@+/, '')
  return raw ? `@${raw}` : ''
}
