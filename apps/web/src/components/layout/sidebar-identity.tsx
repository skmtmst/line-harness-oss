'use client'

import { useBrand } from '@/lib/use-brand'
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

  const name = brand.name || '管理画面'
  const initial = brandInitial(name)

  return <SidebarBrand name={name} mark={initial} />
}

/** 取得処理を持たない共通の看板。運営も同じ横並びで描く。 */
export function SidebarBrand({ name, mark }: { name: string; mark: string }) {
  return (
    <div className={styles.root} data-design-node="J33xq/V2WbXF">
      <span className={styles.mark} aria-hidden="true">{mark}</span>
      <span className={styles.text}>
        <span className={styles.name} title={name}>{name}</span>
        <span className={styles.version}>musubo</span>
      </span>
    </div>
  )
}
