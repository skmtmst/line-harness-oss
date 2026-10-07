'use client'

import { useEffect, useState } from 'react'
import { useBrand } from '@/lib/use-brand'
import { loadAdminVersion } from '@/lib/admin-version-cache'
import { isRealVersion } from '@/lib/deploy-info'
import styles from './sidebar-identity.module.css'
import { brandInitial } from './brand-initial'

/**
 * 共通メニューのいちばん上。**アイコン ＋ 会社名 ＋ バージョン**だけ。
 *
 * ここには 2026-08-26 まで「現在のLINEアカウント」の切替カードがあった。
 * 切替は共通トップバーへ移したので、ここは**いまどの会社の管理画面を
 * 見ているか**だけを示す（Pencil `J33xq/V2WbXF`、`docs/v8-design-rules.md` §5）。
 *
 * 枠も影も付けない。カードにすると、下のメニューと同じ重さに見えて、
 * 押せるものだと読み違える。ここは押せない。
 */
export default function SidebarIdentity() {
  const brand = useBrand()
  const [version, setVersion] = useState('')

  useEffect(() => {
    let cancelled = false
    // 更新案内の帯と同じ版番号を共有する（2回取らない）。
    ;(async () => {
      try {
        const { version } = await loadAdminVersion()
        if (!cancelled && version) setVersion(version)
      } catch {
        // 取れなければ出さない。「Ver. -」のような穴埋めはしない。
      }
    })()
    return () => { cancelled = true }
  }, [])

  const name = brand.name || '管理画面'
  const initial = brandInitial(name)

  return (
    <div className={styles.root} data-design-node="J33xq/V2WbXF">
      <span className={styles.mark} aria-hidden="true">{initial}</span>
      <span className={styles.text}>
        <span className={styles.name} title={name}>{name}</span>
        {/* V8 では社名の下に製品名を出す（版の情報はメニューの一番下にある）。
            v7 では今までどおり版を出す。 */}
        <span className={`${styles.version} v8-only`}>musubo</span>
        {isRealVersion(version) && <span className={`${styles.version} v7-only`}>Ver. {version.trim()}</span>}
      </span>
    </div>
  )
}
