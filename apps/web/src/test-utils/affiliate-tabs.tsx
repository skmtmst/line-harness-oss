import type { ReactNode } from 'react'
import { AffiliatorsTab as AffiliatorsV8 } from '@/v8/affiliates/public/affiliators/index'
import { ApprovalsTab as ApprovalsV8 } from '@/v8/affiliates/public/approvals/index'
import { OffersTab as OffersV8 } from '@/v8/affiliates/public/offers/index'
import { AffiliateShell, type AffiliateTabKey } from '@/v8/affiliates/public/frame/index'

export { distributionUrl } from '@/v8/affiliates/display'

type Props = { accountId?: string | null; focusAffiliateId?: string | null; readonly?: boolean }

/** 現役の外枠に試験のアカウントを渡すだけ。画面と通信は本物を使う。 */
function Frame({ tab, accountId = 'acc-1', focusAffiliateId = null, readonly = false, children }: Props & { tab: AffiliateTabKey; children: ReactNode }) {
  return <AffiliateShell.Provider value={{ tab, readonly, narrow: false, accountId, focusAffiliateId, counts: {}, setCount: () => {} }}>{children}</AffiliateShell.Provider>
}

export function AffiliatorsTab(props: Props) {
  return <Frame {...props} tab="affiliates"><AffiliatorsV8 /></Frame>
}

export function ApprovalQueue(props: Props) {
  return <Frame accountId={null} {...props} tab="approvals"><ApprovalsV8 /></Frame>
}

export function OffersTab(props: Props) {
  return <Frame {...props} tab="offers"><OffersV8 /></Frame>
}
