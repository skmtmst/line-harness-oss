'use client'

/*
 * ★V8-B EC連携の「つなぎ先」（板 `iLJmw`）。
 *
 * 入力そのものは今のつなぎ先の板（`connector-panel.tsx`）をそのまま使う。
 * V8 の枠（題・説明・設定の中の案内・入口のタブ・板ID）だけを足す。
 * 見るだけの担当者には保存の入口を出さない（組③の閲覧のみ）。
 */

import Button from '@/components/shared/button'
import SettingsInnerNav from '@/components/layout/settings-inner-nav'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import ConnectorPanel from './connector-panel'
import EcTabs from './ec-tabs-view'
import styles from './ec-connector-v8.module.css'

export default function EcConnectorV8() {
  usePageTitle('EC連携')
  const { selectedAccountId } = useAccount()
  const staffRole = useStaffRole()
  const canEdit = staffRole === null || canManageRole(staffRole)

  return (
    <div className={styles.board} data-design-node="iLJmw">
      <div className={styles.head}>
        <div>
          <h2 className={styles.headTitle}>EC連携</h2>
          <p className={styles.headDescription}>
            ネットショップから注文・発送・定期便の出来事を取り込み、LINEの友だちと結びつけます。
          </p>
        </div>
        <Button href="/ec-commerce?tab=connector" variant="secondary">つなぎ先の設定</Button>
      </div>
      <div className={styles.body}>
        <SettingsInnerNav />
        <div className={styles.main}>
          <EcTabs accountId={selectedAccountId} active="connector" />
          <ConnectorPanel accountId={selectedAccountId} canEdit={canEdit} />
        </div>
      </div>
    </div>
  )
}
