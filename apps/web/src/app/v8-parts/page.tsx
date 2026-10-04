'use client'

import { useState } from 'react'
import { Send, Sparkles, Users, Workflow } from 'lucide-react'
import StatusBadge from '@/components/shared/status-badge'
import DeltaChip from '@/components/shared/delta-chip'
import Chip from '@/components/shared/chip'
import RouteBadge from '@/components/shared/route-badge'
import AttentionStar from '@/components/shared/attention-star'
import Avatar from '@/components/shared/avatar'
import IconTile from '@/components/shared/icon-tile'
import HelpTip from '@/components/shared/help-tip'
import { ActivityMarker } from '@/components/shared/activity-item'
import { ProgressBar } from '@/components/shared/progress'
import styles from './page.module.css'

/** Static examples only. The local verification server serves the unmodified Pencil HTML. */
export default function V8PartsPage() {
  const [starred, setStarred] = useState(true)
  const parts = [
    { id: 'mpVfY', name: '状態の札・対応済み', node: <StatusBadge tone="success">対応済み</StatusBadge> },
    { id: 'ekmYd', name: '状態の札・予約中', node: <StatusBadge tone="info">予約中</StatusBadge> },
    { id: 'ii85L', name: '状態の札・対応中', node: <StatusBadge tone="warning">対応中</StatusBadge> },
    { id: 'XwfSH', name: '状態の札・未対応', node: <StatusBadge tone="danger">未対応</StatusBadge> },
    { id: 'hQeAo', name: '状態の札・下書き', node: <StatusBadge>下書き</StatusBadge> },
    { id: 'C6DGX', name: '増減の札・良い', node: <DeltaChip tone="up">+2.6%</DeltaChip> },
    { id: 'OEQxt', name: '増減の札・悪い', node: <DeltaChip tone="down">−1.1pt</DeltaChip> },
    { id: 'r9qfM2', name: '増減の札・要確認', node: <DeltaChip tone="attention">要確認</DeltaChip> },
    { id: 'h7Ch3y', name: 'タグ', node: <Chip>定期便</Chip> },
    { id: 'HNps2', name: '経路の札', node: <RouteBadge>LINE</RouteBadge> },
    { id: 'zcGgI', name: '注目の星・オフ', node: <AttentionStar pressed={false} aria-label="注目の星・オフの見本" /> },
    { id: 'w0R1PQ', name: '注目の星・オン', node: <AttentionStar pressed aria-label="注目の星・オンの見本" /> },
    { id: 'MFTlt', name: '顔・小', node: <Avatar name="山本" size={28} /> },
    { id: 'pDKi6', name: '顔・中', node: <Avatar name="山本" size={34} /> },
    { id: 'zjEbn', name: '顔・大', node: <Avatar name="山本" size={52} /> },
    { id: 'C9CaMS', name: '印のタイル・小', node: <IconTile icon={Users} size="sm" /> },
    { id: 'E7USZ9', name: '印のタイル・中', node: <IconTile icon={Sparkles} size="md" /> },
    { id: 'A2mryd', name: '印のタイル・大', node: <IconTile icon={Workflow} size="lg" /> },
    { id: 'KjC1z', name: '補足の？', node: <HelpTip label="部品の説明">正本の16pxの円です。押すと説明を開きます。</HelpTip> },
    { id: 'x4FeKG', name: '動きの印', node: <ActivityMarker icon={Send} /> },
    { id: 'tydx2', name: '進みの棒', node: <div style={{ width: 300 }}><ProgressBar value={190 / 3} label="進みの棒の見本" /></div> },
  ]

  return (
    <div data-theme="v8" className={styles.page}>
      <h1>V8 共通部品の確認 — badges</h1>
      <p>左は正本HTML、右は共通部品。正本はローカル確認サーバーから読み込みます。</p>
      {parts.map(({ id, name, node }) => (
        <section key={id} id={id} data-part-case={id} className={styles.case}>
          <h2>{id} — {name}</h2>
          <div data-comparison={id} className={styles.comparison}>
            <div className={styles.side}>
              <span>絵</span>
              <iframe title={`${id} の正本`} src={`/v8-parts/reference/${id}.html`} className={styles.reference} />
            </div>
            <div className={styles.side}>
              <span>実装</span>
              <div data-implementation={id} className={styles.sample}>{node}</div>
            </div>
          </div>
        </section>
      ))}
      <section className={styles.case}>
        <h2>操作の確認</h2>
        <AttentionStar pressed={starred} onClick={() => setStarred((value) => !value)} aria-label="注目を切り替える" />
        <HelpTip label="操作確認の説明">Escapeキーで閉じ、押した？へ戻ります。</HelpTip>
      </section>
    </div>
  )
}
