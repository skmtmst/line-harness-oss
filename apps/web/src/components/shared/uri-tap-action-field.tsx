'use client'

/*
 * 「押したら」の共通の欄（TapActionField）を、開く URL の文字だけを保存する所で使う包み
 * （回答フォームのリンクのボタン・LINE 通知のカードのボタンなど）。
 * 予約・回答フォーム・予約履歴・来店スタンプはアカウントの LIFF の URL にして返す
 * （LIFF ID がまだ無いときは {{liff_id}} のまま。欄には LIFF の案内が出る）。テキストを送るは URL で持てないので出さない。
 */
import TapActionField from './tap-action-field'
import { tapLiffIdOf, useTapActionAccount, useTapActionSources } from './use-tap-action-sources'
import { tapActionFromSavedUri, tapActionLiffUrl, tapActionNeedsLiff, type TapActionKind } from '@/lib/tap-actions'

export const URI_TAP_KINDS: readonly TapActionKind[] = ['uri', 'booking', 'form', 'booking_history', 'visit_stamp']

export default function UriTapActionField({ name, url, onChange, accountId, kinds = URI_TAP_KINDS, kindLabel, uriPlaceholder, readOnly }: {
  name: string
  url: string
  onChange: (url: string) => void
  /** LIFF ID と作ってあるものを読むアカウント（省くと上のバーのアカウント）。 */
  accountId?: string | null
  kinds?: readonly TapActionKind[]
  kindLabel?: string
  uriPlaceholder?: string
  readOnly?: boolean
}) {
  const account = useTapActionAccount()
  const targetId = accountId === undefined ? account?.selectedAccountId ?? null : accountId
  const liffId = tapLiffIdOf(account, targetId)
  const sources = useTapActionSources(targetId)
  const value = tapActionFromSavedUri(url)
  return (
    <TapActionField
      name={name}
      kindLabel={kindLabel}
      value={value}
      onChange={(patch) => {
        const kind = patch.kind ?? value.kind
        const changed = patch.kind !== undefined && patch.kind !== value.kind
        if (kind === 'uri') { onChange(patch.uri ?? (changed ? '' : url)); return }
        if (tapActionNeedsLiff(kind)) onChange(tapActionLiffUrl(liffId || '{{liff_id}}', kind, patch.refId ?? (changed ? '' : value.refId)))
      }}
      kinds={kinds}
      hasLiff={Boolean(liffId)}
      liffSettingsHref={targetId ? `/accounts/detail?id=${encodeURIComponent(targetId)}` : '/accounts'}
      sources={sources}
      uriPlaceholder={uriPlaceholder}
      readOnly={readOnly}
    />
  )
}
