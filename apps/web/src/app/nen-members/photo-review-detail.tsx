'use client'

import { useState } from 'react'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'
import { formatPhotoReceivedAt } from './photo-review-time'
import styles from './photo-review.module.css'

const text = (value: unknown) => String(value ?? '')
const numberOrDash = (value: unknown) => Number.isFinite(Number(value)) ? Number(value).toLocaleString('ja-JP') : '—'

export function PhotoReviewDetail({
  photo, position, total, loading, loadKind, reviewing, onBack, onMove, onApprove, onReturn,
}: {
  photo: Record<string, unknown> | null
  position: number
  total: number
  loading: boolean
  loadKind: 'ready' | 'empty' | 'error' | 'forbidden'
  reviewing: boolean
  onBack: () => void
  onMove: (direction: -1 | 1) => void
  onApprove: () => void
  onReturn: () => void
}) {
  const [scale, setScale] = useState(1)
  const [rotation, setRotation] = useState(0)
  if (loading) return <main className={styles.workspace}><ListState kind="loading" title="写真を読み込んでいます" /></main>
  if (loadKind === 'forbidden') return <main className={styles.workspace}><ListState kind="forbidden" /></main>
  if (loadKind === 'error') return <main className={styles.workspace}><ListState kind="error" title="写真を読み込めませんでした" /></main>
  if (!photo || loadKind === 'empty') return <main className={styles.workspace}><ListState kind="empty" title="確認する写真はありません" /></main>

  const risks = Array.isArray(photo.risks) ? photo.risks as Array<Record<string, unknown>> : []
  const hasFaceRisk = risks.some((risk) => text(risk.flag) === 'face')
  return <main className={styles.workspace} data-photo-view="detail">
    <div className={styles.detailTop}>
      <div>
        <p className={styles.eyebrow}>写真審査</p>
        <h1 className={styles.detailTitle}>{text(photo.pet_name) || 'ペット'} の写真</h1>
      </div>
      <div className={styles.detailNav}>
        <span className={styles.position}>{total > 0 ? `${total}枚のうち ${position + 1}枚目` : '—'}</span>
        <Button disabled={position <= 0} onClick={() => onMove(-1)}>前の写真</Button>
        <Button disabled={position >= total - 1} onClick={() => onMove(1)}>次の写真</Button>
        <Button onClick={onBack}>並べて見るへ戻る</Button>
      </div>
    </div>

    {hasFaceRisk && <div className={styles.riskBanner}>うしろに人の顔が写っている可能性があります（自動で見つけました）</div>}

    <div className={styles.detailGrid}>
      <section className={styles.photoPanel}>
        <div className={styles.reviewCanvas}>
          {text(photo.image_url) ? <img
            src={text(photo.image_url)}
            alt={`${text(photo.pet_name)}の審査用写真`}
            className={styles.reviewImage}
            style={{ transform: `scale(${scale}) rotate(${rotation}deg)` }}
          /> : <p className={styles.imageMissing}>審査用の画像を作成中です</p>}
        </div>
        <div className={styles.imageTools}>
          <Button onClick={() => setScale((value) => Math.min(1.5, value + 0.1))}>大きく</Button>
          <Button onClick={() => setScale((value) => Math.max(0.7, value - 0.1))}>小さく</Button>
          <Button onClick={() => setRotation((value) => value + 90)}>回す</Button>
          <Button disabled title="切り取りは派生画像の生成口を接続後に使えます">切り取る</Button>
          <Button disabled title="原本の保存には専用権限と再認証が必要です">もとの画像を保存</Button>
        </div>
        <p className={styles.imageMeta}>{numberOrDash(photo.image_width)} × {numberOrDash(photo.image_height)} ／ {photo.image_byte_size == null ? '—（未取得）' : `${(Number(photo.image_byte_size) / 1024 / 1024).toFixed(1)}MB`} ／ {text(photo.captured_device) || '—（未取得）'}</p>
      </section>

      <aside className={styles.detailAside}>
        <section className={styles.infoCard}>
          <dl className={styles.metaList}>
            <div><dt>送ってくれた人</dt><dd>{text(photo.owner_name) || '名前未取得'}</dd><small>投稿 {numberOrDash(photo.submission_count)}回目 ／ 戻したこと {numberOrDash(photo.returned_count)}回</small></div>
            <div><dt>ペット</dt><dd>{text(photo.pet_name) || '未取得'}（{text(photo.animal_type) === 'cat' ? '猫' : '犬'}・{text(photo.breed) || '品種未取得'}）</dd></div>
            <div><dt>届いた日時</dt><dd>{formatPhotoReceivedAt(photo.created_at)}</dd></div>
            <div><dt>そえられた言葉</dt><dd>{text(photo.caption) ? `「${text(photo.caption)}」` : 'コメントなし'}</dd></div>
          </dl>
        </section>
        <section className={styles.infoCard}>
          <h2 className={styles.sideTitle}>自動で見つけたこと</h2>
          {risks.length === 0 ? <p className={styles.sideNote}>注意候補はありません。公開の最終判断は人が行います。</p> : risks.map((risk, index) => <div key={`${text(risk.flag)}-${index}`} className={styles.riskRow}>
            <strong>{text(risk.note) || text(risk.flag)}</strong>
            <span>{risk.confidence == null ? '確からしさは未取得' : `可能性 ${Math.round(Number(risk.confidence) * 100)}%`}</span>
          </div>)}
        </section>
        <section className={styles.infoCard}>
          <h2 className={styles.sideTitle}>つながる先</h2>
          <p className={styles.linkLine}>ECポイント <span>通したら5ポイントの手続きを始める</span></p>
          <p className={styles.linkLine}>LINE通知 <span>審査結果を本人へ送る</span></p>
          <p className={styles.linkLine}>登録メディア <span>公開用画像の置き場</span></p>
        </section>
      </aside>
    </div>
    <div className={styles.stickyActions}>
      <p>{total}枚のうち {position + 1}枚目。あと{Math.max(0, total - position - 1)}枚あります。</p>
      <div>
        <Button disabled={reviewing} onClick={onReturn}>戻す（理由を選ぶ）</Button>
        <Button disabled title="切り取り版の生成口を接続後に使えます">切り取ってから通す</Button>
        <Button variant="primary" disabled={reviewing} onClick={onApprove}>{reviewing ? '処理中...' : 'このまま通す'}</Button>
      </div>
    </div>
  </main>
}
