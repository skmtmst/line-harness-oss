'use client'

import { useEffect, useState } from 'react'
import { loadAdminVersionDetail } from '@/lib/admin-version-cache'
import { formatDeployInfo, type DeployInfoLines } from '@/lib/deploy-info'
import { useUpdateStatus } from '@/components/update/use-update-status'
import TextLink from '@/components/shared/text-link'
import { ChevronDown } from 'lucide-react'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import HelpTip from '@/components/shared/help-tip'
import styles from './sidebar-version.module.css'

/**
 * 共通メニューのいちばん下。いま動いている版と環境の1行。押すと commit・配備日時が開く。
 * 設計 ★管理画面 監査の直し E（`PjoNp`）。
 *
 * 取れない・仮の値のときは「版の情報なし」。穴埋めの数字は出さない。
 * 開け閉めはネイティブの details/summary（キーボードと読み上げが最初から効く）。
 */
export default function SidebarVersion() {
  const [lines, setLines] = useState<DeployInfoLines | null>(null)
  const [ready, setReady] = useState(false)
  const update = useUpdateStatus()
  const role = useStaffRole()
  const canUpdate = canManageRole(role)

  useEffect(() => {
    let cancelled = false
    loadAdminVersionDetail().then(
      (detail) => {
        if (cancelled) return
        setLines(formatDeployInfo(detail))
        setReady(true)
      },
      () => {
        // 取れなければ「版の情報なし」。赤や再読み込みボタンは出さない（1画面に1つ）。
        if (!cancelled) setReady(true)
      },
    )
    return () => { cancelled = true }
  }, [])

  /*
   * 読み込む間も1行ぶんの高さを取っておく（動きの点検 11 番）。null にすると、版が
   * 届いた瞬間に上の「設定」の入口が押し上げられて、全画面で少しずれていた。
   */
  if (!ready) {
    return (
      <div className={`invisible ${styles.root}`} aria-hidden="true" data-version-reserve="">
        <p className={styles.summary}>&nbsp;</p>
      </div>
    )
  }
  if (!lines) return <p className={`${styles.root} ${styles.summary}`}>版の情報なし</p>
  const notice = update.kind === 'upgrade' || update.kind === 'fork'
  /*
   * 毎日使う人には要らない情報なので、版と環境の1行だけにたたむ。
   * 押すと commit・配備の日時と更新の案内が開く。閲覧のみの人にも同じに見せる。
   * 新しい版・カスタマイズ版のときは、たたんだ行にも緑の点で知らせる。
   */
  return (
    <details className={styles.root} data-sidebar-version="">
      <summary className={styles.summary}>
        <span className="truncate">{lines.short}</span>
        {notice ? <span className={styles.dot} role="img" aria-label="更新の案内あり" /> : null}
        <ChevronDown aria-hidden="true" className={styles.chevron} />
      </summary>
      <div className={styles.detail}>
        <p className="whitespace-nowrap">{lines.line1}</p>
        {lines.line2 ? <p>{lines.line2}</p> : null}
        {/*
          新しい版・カスタマイズ版の案内。
          どちらも /updates へ。
        */}
        {canUpdate
          ? <TextLink href="/updates" className="self-start">{update.kind === 'upgrade' ? '更新あり' : '手動で更新'}</TextLink>
          : <HelpTip label={update.kind === 'upgrade' ? '更新あり' : '手動で更新'} trigger={<span className="self-start cursor-not-allowed text-ink-faint" aria-disabled="true">{update.kind === 'upgrade' ? '更新あり' : '手動で更新'}</span>}>更新できるのはオーナーと管理者です。</HelpTip>}
      </div>
    </details>
  )
}
