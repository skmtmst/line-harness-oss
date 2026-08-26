'use client'

import { useEffect, useState } from 'react'
import { useBrand } from '@/lib/use-brand'
import styles from './sidebar-identity.module.css'

/**
 * 共通メニューのいちばん上。**アイコン ＋ 会社名 ＋ バージョン**だけ。
 *
 * ここには 2026-08-26 まで「現在のLINEアカウント」の切替カードがあった。
 * 切替は共通トップバーへ移したので、ここは**いまどの会社の管理画面を
 * 見ているか**だけを示す（Pencil `J33xq/V2WbXF`、`docs/v6-shell-contract.md` §8）。
 *
 * 枠も影も付けない。カードにすると、下のメニューと同じ重さに見えて、
 * 押せるものだと読み違える。ここは押せない。
 */
export default function SidebarIdentity() {
  const brand = useBrand()
  const [version, setVersion] = useState('')

  useEffect(() => {
    let cancelled = false
    const apiUrl = process.env.NEXT_PUBLIC_API_URL
    if (!apiUrl) return
    ;(async () => {
      try {
        const res = await fetch(`${apiUrl}/admin/version`)
        if (!res.ok) return
        const body = (await res.json()) as { version?: string }
        if (!cancelled && body?.version) setVersion(body.version)
      } catch {
        // 取れなければ出さない。「Ver. -」のような穴埋めはしない。
      }
    })()
    return () => { cancelled = true }
  }, [])

  const name = brand.name || '管理画面'
  const initial = name.slice(0, 1)

  return (
    <div className={styles.root} data-design-node="J33xq/V2WbXF">
      <span className={styles.mark} aria-hidden="true">{initial}</span>
      <span className={styles.text}>
        <span className={styles.name} title={name}>{name}</span>
        {version && <span className={styles.version}>Ver. {version}</span>}
      </span>
    </div>
  )
}
