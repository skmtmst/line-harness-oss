'use client'

/*
 * ★V8-B ウェビナーの同時編集の見比べ（板 `pvimJ`）。
 *
 * 帯の「比べてから保存」で開く窓。自分の下書きと相手の最新を
 * 左右に並べ、自分のまま保存するか相手に合わせるか選ぶ。
 * 相手のカードは開いたときに読み直す（409 に付く最新は件数だけのため）。
 */
import { useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import { webinarApi, type WebinarCtaCard } from '@/lib/api'

export type CompareMine = {
  formId: string | null
  formName: string
  cards: WebinarCtaCard[]
}

export type CompareRow = {
  key: string
  label: string
  mine: string
  theirs: string
}

/** 秒を「分:秒」にする（CTA の出すタイミング表示用）。 */
export function formatCueSeconds(atSeconds: number): string {
  const total = Math.max(0, Math.floor(atSeconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** カード1枚を1行の言葉にする。無い側は「（なし）」。 */
export function describeCard(card: WebinarCtaCard | undefined): string {
  if (!card) return '（なし）'
  const title = card.title || '（見出しなし）'
  return `「${title}」／ボタン「${card.buttonLabel || '（言葉なし）'}」／${formatCueSeconds(card.atSeconds)}から`
}

/**
 * 見比べの行を作る。先頭は申込フォーム、続いてカードを枚数の多い方まで
 * 並べる（どちらかに無い番号は「（なし）」）。
 */
export function buildCompareRows(mine: CompareMine, theirsFormName: string, theirsCards: WebinarCtaCard[]): CompareRow[] {
  const rows: CompareRow[] = [{ key: 'form', label: '申込フォーム', mine: mine.formName, theirs: theirsFormName }]
  const count = Math.max(mine.cards.length, theirsCards.length)
  for (let i = 0; i < count; i += 1) {
    rows.push({
      key: `card-${i}`,
      label: `カード${i + 1}`,
      mine: describeCard(mine.cards[i]),
      theirs: describeCard(theirsCards[i]),
    })
  }
  return rows
}

export default function WebinarEditCompareDialog({
  open,
  webinarId,
  mine,
  theirsFormName,
  onKeepMine,
  onUseTheirs,
  onClose,
  working,
  error,
}: {
  open: boolean
  webinarId: string
  mine: CompareMine
  theirsFormName: string
  onKeepMine: () => void
  onUseTheirs: () => void
  onClose: () => void
  working: boolean
  error?: string
}) {
  const [theirsCards, setTheirsCards] = useState<WebinarCtaCard[] | null>(null)
  const [cardsError, setCardsError] = useState('')

  useEffect(() => {
    if (!open) return
    let alive = true
    setTheirsCards(null)
    setCardsError('')
    webinarApi
      .ctas(webinarId)
      .then((response) => {
        if (alive) setTheirsCards(Array.isArray(response.data) ? response.data : [])
      })
      .catch(() => {
        if (alive) setCardsError('相手の最新のカードを読み込めませんでした。件数だけで比べます。')
      })
    return () => {
      alive = false
    }
  }, [open, webinarId])

  const rows = buildCompareRows(mine, theirsFormName, theirsCards ?? [])

  return (
    <Dialog
      open={open}
      title="比べてから保存"
      description="左が自分の下書き、右が相手の最新です。残す方を選んでください。"
      designNode="pvimJ"
      error={error}
      onCancel={onClose}
      footer={(
        <>
          <Button type="button" onClick={onUseTheirs} disabled={working}>
            相手に合わせる
          </Button>
          <Button type="button" variant="primary" onClick={onKeepMine} disabled={working}>
            {working ? '保存しています…' : '自分のまま保存する'}
          </Button>
        </>
      )}
    >
      <div className="grid grid-cols-2 gap-4">
        <h3 className="text-ink text-sm font-semibold">自分の下書き</h3>
        <h3 className="text-ink text-sm font-semibold">相手の最新</h3>
      </div>
      {cardsError ? <p className="text-danger mt-2 text-xs" role="alert">{cardsError}</p> : null}
      {theirsCards === null && !cardsError ? (
        <p className="text-ink-faint mt-3 text-sm">相手の最新のカードを読み込んでいます。</p>
      ) : (
        <dl className="divide-hairline mt-3 divide-y rounded-control border border-hairline">
          {rows.map((row) => (
            <div key={row.key} className="grid grid-cols-2 gap-4 px-4 py-3">
              <div className="min-w-0">
                <dt className="text-ink-faint text-xs font-semibold">{row.label}</dt>
                <dd className="text-ink mt-1 text-sm break-words">{row.mine}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-ink-faint text-xs font-semibold" aria-hidden="true">{row.label}</dt>
                <dd className="text-ink mt-1 text-sm break-words">{row.theirs}</dd>
              </div>
            </div>
          ))}
        </dl>
      )}
    </Dialog>
  )
}
