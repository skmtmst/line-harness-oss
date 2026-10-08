'use client'

/*
 * ★V8 画像の詳細（Pencil `rI5uh`）と、そこから開く「一覧から外す」の確かめ（`B24oNg`）。
 * 共通の窓に絵の幅 860・上からの位置を渡し、中身を絵どおりに組む：
 * 左に画像とダウンロード・お気に入り、右に「アカウントへ配る」（探す・タグの札・アカウントの一覧・渡す）、
 * 下に「生成時の条件」（2列）、いちばん下に 一覧から外す（左）・参照画像にする・同じ設定でもう一度生成（右）。
 * 動き（渡す・外す・お気に入り・もう一度生成）は v7（components/hq/banners/image-detail-modal.tsx）と同じ。
 */
import { Download, ImagePlus, RefreshCw, Send, Star, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import FilterChip from '@/components/shared/filter-chip'
import SearchField from '@/components/shared/search-field'
import type { AccountWithStats } from '@/contexts/account-context'
import { generationConditionRows, type BannerImage, type BannerPreset } from '@/lib/hq-banners'
import { BannerConfirmDialogV8 } from './dialogs'
import BannerDialogFrame from './frame'
import { monthDayTime } from './words'
import styles from './image-detail.module.css'

/** 生成時の条件の行。色は値だけ、作成は「9/30 10:12・1枚目」（絵どおり）。 */
export function conditionRows(image: BannerImage, presets: BannerPreset[]): Array<{ label: string; value: string }> {
  return generationConditionRows(image, presets).map((row) => {
    if (row.label === '色' && image.generation) {
      const g = image.generation
      const colors = [g.baseColor, g.mainColor, g.subColor, g.accentColor].filter(Boolean)
      return colors.length > 0 ? { label: '色', value: colors.join('・') } : row
    }
    if (row.label === '作成') return { label: '作成', value: `${monthDayTime(image.createdAt)}・${image.sequence}枚目` }
    return row
  })
}

export function BannerImageDetailV8({
  image,
  presets,
  accounts,
  canManage,
  busy,
  error,
  onClose,
  onToggleFavorite,
  onDeliver,
  onRemove,
  onRegenerate,
  onUseAsReference,
}: {
  image: BannerImage
  presets: BannerPreset[]
  accounts: AccountWithStats[]
  /** 閲覧のみ（オーナー・管理者でない）は、渡す・外す・お気に入り・もう一度生成を置かない。 */
  canManage: boolean
  busy?: boolean
  error?: string
  onClose: () => void
  onToggleFavorite: () => void
  /** WEB204：成功したら true。失敗したら false（窓・選択を片付けない）。 */
  onDeliver: (lineAccountIds: string[]) => Promise<boolean>
  onRemove: () => Promise<boolean>
  /** 生成画像だけ。取り込み画像では出さない。 */
  onRegenerate?: () => void
  /** 「参照画像にする」。プロジェクトの中から開いたときだけ渡す。 */
  onUseAsReference?: () => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [tagId, setTagId] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  // 読めない画像は壊れた印を出さず、地の色のままにする。
  const [previewFailed, setPreviewFailed] = useState(false)

  // アーカイブしたアカウントへは渡さない（受け取る口が止まっている）。
  const targets = useMemo(() => accounts.filter((a) => !a.archivedAt), [accounts])
  const tags = useMemo(() => Array.from(new Map(targets.flatMap((a) => a.tags ?? []).map((t) => [t.id, t])).values()), [targets])
  const delivered = useMemo(() => new Set(image.deliveredAccountIds), [image.deliveredAccountIds])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return targets.filter((a) => (!tagId || a.tags?.some((t) => t.id === tagId)) && (!q ||
      `${a.displayName ?? a.name}\n${a.basicId ?? ''}\n${a.channelId ?? ''}\n${(a.tags ?? []).map((t) => t.name).join(' ')}`.toLowerCase().includes(q)))
  }, [targets, query, tagId])
  const rows = conditionRows(image, presets)
  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  if (confirmRemove) {
    // 絵 B24oNg：詳細の窓は閉じ、確かめる窓だけを出す。やめると詳細へ戻る。
    return (
      <BannerConfirmDialogV8
        open
        title="この画像を一覧から外しますか？"
        description="統括の一覧に出なくなります。すでにアカウントへ配った画像は、そのアカウントの登録メディアに残ります。"
        confirmLabel="一覧から外す"
        tone="danger"
        busy={busy}
        error={error}
        designNode="B24oNg"
        onConfirm={() => void onRemove().then((ok) => { if (ok) setConfirmRemove(false) })}
        onCancel={() => setConfirmRemove(false)}
      />
    )
  }

  const handle = (account: AccountWithStats) => {
    const id = account.basicId ? `@${account.basicId.replace(/^@/, '')}` : account.channelId ?? ''
    return [id, ...(account.tags ?? []).map((t) => t.name)].filter(Boolean).join('・')
  }

  return (
    <BannerDialogFrame
      open
      kind="detail"
      title="画像の詳細"
      onClose={onClose}
      busy={busy}
      error={error || undefined}
      designNode="rI5uh"
      actionsAlign="split"
      actions={(
        <>
          {canManage ? (
            <button type="button" className={styles.remove} onClick={() => setConfirmRemove(true)} disabled={busy}>
              <Trash2 aria-hidden="true" className={styles.icon} />一覧から外す
            </button>
          ) : null}
          <span className={styles.spacer} />
          {canManage && onUseAsReference ? (
            <Button onClick={onUseAsReference} disabled={busy}>
              <ImagePlus aria-hidden="true" className={styles.icon} />参照画像にする
            </Button>
          ) : null}
          {canManage && onRegenerate ? (
            <Button onClick={onRegenerate} disabled={busy}>
              <RefreshCw aria-hidden="true" className={styles.icon} />同じ設定でもう一度生成
            </Button>
          ) : null}
        </>
      )}
    >
      <div className={styles.body}>
        <div className={styles.top}>
          <div className={styles.left}>
            <div className={styles.preview}>
              {previewFailed ? null : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image.media.url} alt="" onError={() => setPreviewFailed(true)} />
              )}
            </div>
            <div className={styles.buttons}>
              <Button href={image.media.url} target="_blank" rel="noreferrer" download={image.media.filename}>
                <Download aria-hidden="true" className={styles.icon} />ダウンロード
              </Button>
              {canManage ? (
                <Button onClick={onToggleFavorite} disabled={busy} aria-pressed={image.isFavorite}>
                  <Star aria-hidden="true" className={image.isFavorite ? `${styles.icon} ${styles.starOn}` : styles.icon} />お気に入り
                </Button>
              ) : null}
            </div>
          </div>

          <section className={styles.deliver} aria-label="アカウントへ配る">
            <h3 className={styles.sectionTitle}>アカウントへ配る</h3>
            <p className={styles.note}>配ったアカウントの登録メディア（フォルダ「02_バナー」）に入ります</p>
            <SearchField
              placeholder="アカウント名・タグで探す"
              aria-label="配るアカウントをアカウント名・タグで探す"
              value={query}
              onChange={setQuery}
              onClear={() => setQuery('')}
            />
            <div className={styles.chips} role="group" aria-label="配布先のタグ">
              <FilterChip selected={!tagId} onChange={() => setTagId(null)}>{`すべて ${targets.length}`}</FilterChip>
              {tags.map((t) => (
                <FilterChip key={t.id} selected={tagId === t.id} icon={<Star size={14} aria-hidden="true" />} onChange={(on) => setTagId(on ? t.id : null)}>{t.name}</FilterChip>
              ))}
            </div>
            {targets.length === 0 ? (
              <p className={styles.note}>この統括にアカウントがありません。</p>
            ) : visible.length === 0 ? (
              <p className={styles.note}>当てはまるアカウントがありません。</p>
            ) : (
              <ul className={styles.accounts}>
                {visible.map((account) => {
                  const already = delivered.has(account.id)
                  const name = account.displayName ?? account.name
                  return (
                    <li key={account.id} className={already ? `${styles.account} ${styles.accountDone}` : styles.account}>
                      <Checkbox
                        checked={already || selected.includes(account.id)}
                        disabled={already || busy || !canManage}
                        onCheckedChange={() => toggle(account.id)}
                        aria-label={`${name}へ配布`}
                      />
                      <span className={styles.accountText}>
                        <span className={styles.accountName} title={name}>{name}</span>
                        <span className={styles.accountHandle}>{handle(account)}</span>
                      </span>
                      {already ? <span className={styles.pillOk}><span className={styles.dot} aria-hidden="true" />配布済み</span> : null}
                    </li>
                  )
                })}
              </ul>
            )}
            {canManage ? (
              <div className={styles.deliverFoot}>
                <span className={styles.note}>{selected.length > 0 ? `${selected.length} アカウントを選んでいます` : 'アカウントを選んでください'}</span>
                <span className={styles.spacer} />
                <Button
                  variant="primary"
                  disabled={busy || selected.length === 0}
                  onClick={() => void onDeliver(selected).then((ok) => { if (ok) setSelected([]) })}
                  busy={busy}
                  busyLabel="配っています…"
                >
                  <Send aria-hidden="true" className={styles.icon} />{`${selected.length}アカウントへ配る`}
                </Button>
              </div>
            ) : null}
          </section>
        </div>

        <section className={styles.conditions} aria-label={image.generation ? '生成時の条件' : 'この画像について'}>
          <h3 className={styles.sectionTitle}>{image.generation ? '生成時の条件' : 'この画像について'}</h3>
          <div className={styles.conditionCols}>
            {[rows.slice(0, 3), rows.slice(3)].map((column, index) => (
              <dl key={index} className={styles.conditionCol}>
                {column.map((row) => (
                  <div key={row.label} className={styles.conditionRow}>
                    <dt>{row.label}</dt>
                    <dd className={row.label === 'テキスト' ? styles.multiline : undefined} title={row.value}>{row.value}</dd>
                  </div>
                ))}
              </dl>
            ))}
          </div>
        </section>

      </div>
    </BannerDialogFrame>
  )
}
