'use client'

import { useSyncExternalStore } from 'react'
import { CONFIGURED_CONTACT_URL } from '@/lib/auth-email'
import { readStaffIdentity, subscribeStaffIdentity } from '@/lib/staff-identity-state'
import { loadFailureCopy, loadFailureNotice } from './api-error-message'
import TextLink from './text-link'

const standardDescription = loadFailureCopy(undefined, 'この画面').description
const standardNotice = loadFailureNotice(undefined, 'この画面')
const unknownCount = '読み込めていないため件数は分かりません。'
const standardPrefixes = new Map([
  [standardDescription, ''],
  [unknownCount + standardDescription, unknownCount],
  [standardNotice, standardNotice.slice(0, -standardDescription.length)],
])
const serverIdentity = () => null

function ContactInstruction({ prefix }: { prefix: string }) {
  // 本人の読取を増やさず、認証側が確かめた情報だけを購読する。
  const identity = useSyncExternalStore(subscribeStaffIdentity, readStaffIdentity, serverIdentity)
  const internal = identity?.accountScope === 'all'
  const href = internal ? '/hq/support' : CONFIGURED_CONTACT_URL
  return <>{prefix}{href ? <>直らない時は<TextLink href={href} inline external={!internal}>お問い合わせ</TextLink>から知らせてください。</> : '管理者にお問い合わせください。'}</>
}

/** 共通の失敗案内だけを押せる窓口へ。画面固有の案内はそのまま残す。 */
export default function LoadFailureContact({ description }: { description: string }) {
  const prefix = standardPrefixes.get(description)
  return prefix === undefined ? <>{description}</> : <ContactInstruction prefix={prefix} />
}
