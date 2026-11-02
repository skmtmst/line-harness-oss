'use client'

import { useEffect, useState } from 'react'
import { loadLineAccounts } from '@/lib/line-accounts-cache'
import { DetailContent, DetailFields, DetailSection } from './detail-content'
import { deployEnvLabel } from '@/lib/deploy-info'
import { useRunningVersion } from '@/lib/use-running-version'

export type OperationAccountTarget = { id: string; name?: string | null; label?: string }
export type OperationStoreTarget = { id: string; name?: string | null }

/** 操作先を呼び出し側から受け取り、現在選択中の別の対象で穴埋めしない。 */
export default function OperationTargetSummary({ accounts, allAccounts = false, store, externalTarget, showAccountCount = false }: {
  accounts: OperationAccountTarget[]
  allAccounts?: boolean
  store?: OperationStoreTarget
  externalTarget?: { label: string; name?: string | null }
  showAccountCount?: boolean
}) {
  const [names, setNames] = useState<Record<string, string>>({})
  const missingKey = JSON.stringify(accounts.filter(account => account.id && !account.name?.trim()).map(account => account.id))
  useEffect(() => {
    let active = true
    if (missingKey === '[]') return
    void Promise.resolve().then(() => loadLineAccounts()).then(response => {
      if (active && response.success) setNames(Object.fromEntries(response.data.map(account => [account.id, account.name])))
    }).catch(() => { if (active) setNames({}) })
    return () => { active = false }
  }, [missingKey])
  const version = useRunningVersion()
  const environment = deployEnvLabel(version.detail?.deploy_env)
    ?? (version.statusText === '確認中' ? '確認中' : '確認できません')
  return <DetailContent><DetailSection label="操作の対象"><DetailFields>
    {allAccounts ? <div><dt>LINEアカウント</dt><dd>すべてのLINEアカウント</dd></div> : null}
    {showAccountCount ? <div><dt>対象アカウント数</dt><dd>{accounts.some(account => !account.id) ? '確認できません' : `${accounts.length}件`}</dd></div> : null}
    {accounts.map((target, index) => { const account = { ...target, name: target.name?.trim() || names[target.id] }; return <div key={`${account.id}:${index}`}>
      <dt>{account.label ?? 'LINEアカウント'}</dt>
      <dd><span className={showAccountCount ? 'block min-w-0 break-all' : 'block min-w-0 truncate'} title={account.name?.trim() ? `${account.name}（${account.id}）` : account.id}>{account.name?.trim() || '名前を確認できません'}</span></dd>
    </div>})}
    {store ? <div><dt>店舗</dt><dd><span className="block min-w-0 truncate" title={store.name?.trim() ? `${store.name}（${store.id}）` : store.id}>{store.name?.trim() || '名前を確認できません'}</span></dd></div> : null}
    {externalTarget ? <div><dt>{externalTarget.label}</dt><dd><span className="block min-w-0 truncate" title={externalTarget.name?.trim() || undefined}>{externalTarget.name?.trim() || '名前を確認できません'}</span></dd></div> : null}
    <div><dt>環境</dt><dd><span className="block min-w-0 truncate" title={environment}>{environment}</span></dd></div>
  </DetailFields></DetailSection></DetailContent>
}
