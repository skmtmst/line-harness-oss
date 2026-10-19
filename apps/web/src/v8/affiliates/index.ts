// この機能が外へ公開する名前。機能内では宣言元を直接読む。
export { default as CreateAffiliateV8 } from './create'
export { default as AffiliatesV8 } from './affiliates'
export { default as AffiliatorsTab } from './affiliators'
export { default as ApprovalsTab } from './approvals'
export { default as OffersTab } from './offers'
export { AffiliateShell } from './frame'
export type { AffiliateTabKey } from './frame'
