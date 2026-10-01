'use client'

import { useEffect, useState } from 'react'
import { loadAdminVersionDetail } from '@/lib/admin-version-cache'
import { formatDeployInfo, type DeployInfoLines } from '@/lib/deploy-info'
import { useUpdateStatus } from '@/components/update/use-update-status'
import TextLink from '@/components/shared/text-link'

/**
 * 共通メニューのいちばん下。いま動いている版・commit・配備日時と環境。
 * 設計 ★V7 監査の直し E（`PjoNp`）。
 *
 * 取れない・仮の値のときは「版の情報なし」。穴埋めの数字は出さない。
 * 押せない飾りなので button や link にしない。
 * 見た目はトークンの文字だけ（負債検査で静的に読める形にする）。
 */
export default function SidebarVersion() {
  const [lines, setLines] = useState<DeployInfoLines | null>(null)
  const [ready, setReady] = useState(false)
  const update = useUpdateStatus()

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

  if (!ready) return null
  if (!lines) return <p className="border-t border-hairline px-4 pb-3 pt-2.5 text-micro text-ink-faint">版の情報なし</p>
  return (
    <div className="border-t border-hairline px-4 pb-3 pt-2.5">
      <p className="truncate text-caption font-medium text-ink-secondary" title={lines.line1}>{lines.line1}</p>
      {lines.line2 ? <p className="mt-0.5 text-micro text-ink-faint">{lines.line2}</p> : null}
      {/*
        ★V8（夕12・FK5m7 ZT5kI）：上の版の帯を隠した v8 では、新しい版・
        カスタマイズ版の案内をこの行に出す。どちらも /updates へ。
        v7 は帯が出るので出さない（v8-only）。
      */}
      {update.kind === 'upgrade' ? (
        <p className="v8-only mt-1">
          <TextLink href="/updates">更新あり</TextLink>
        </p>
      ) : null}
      {update.kind === 'fork' ? (
        <p className="v8-only mt-1">
          <TextLink href="/updates">手動で更新</TextLink>
        </p>
      ) : null}
    </div>
  )
}
