'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import TermsDocumentContent from '@/components/legal/terms-document'
import { TERMS_DOCUMENT, TERMS_IS_DRAFT } from '@/content/terms/musubo-terms'
import { canSubmitTerms, hasReadTerms } from './terms-state'

export default function TermsConsent({ onAgree }: { onAgree: () => Promise<void> }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [readToEnd, setReadToEnd] = useState(false)
  const [checked, setChecked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const evaluate = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    if (hasReadTerms(element)) setReadToEnd(true)
  }, [])

  useEffect(() => {
    evaluate()
    const element = scrollRef.current
    if (!element) return
    const observer = new ResizeObserver(evaluate)
    observer.observe(element)
    return () => observer.disconnect()
  }, [evaluate])

  const agree = async () => {
    if (!canSubmitTerms(readToEnd, checked) || saving) return
    setSaving(true)
    setError('')
    try {
      await onAgree()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '同意を記録できませんでした。時間を置いてもう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }

  const disabledReason = !readToEnd
    ? '利用規約を最後までお読みください。'
    : !checked
      ? '同意する場合は、上のチェックボックスにチェックを入れてください。'
      : ''

  return <div className="mt-7 space-y-5">
    <p className="text-sm font-semibold text-ink">{TERMS_DOCUMENT.title}（{TERMS_DOCUMENT.version} / {TERMS_DOCUMENT.displayDate}）</p>
    {TERMS_IS_DRAFT && <div className="rounded-control border border-warning bg-warning-bg px-4 py-3 text-sm leading-6 text-warning">
      これは開発中の仮の利用規約です。正式版の公開時に、あらためて同意をお願いします。
    </div>}
    <div
      ref={scrollRef}
      onScroll={evaluate}
      tabIndex={0}
      role="region"
      aria-label="利用規約"
      className="max-h-[420px] overflow-y-auto rounded-card border border-hairline bg-canvas-sunken p-5 outline-none focus:border-accent"
    >
      <TermsDocumentContent />
    </div>
    <label className={`flex items-start gap-3 rounded-control border border-hairline px-4 py-3 text-sm font-semibold ${readToEnd ? 'cursor-pointer text-ink' : 'cursor-not-allowed text-ink-faint'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={!readToEnd || saving}
        onChange={(event) => setChecked(event.target.checked)}
        className="mt-0.5 h-4 w-4 accent-accent"
      />
      上記の利用規約および個人情報の取扱いに同意します
    </label>
    {disabledReason && <p className="text-xs font-semibold text-warning">{disabledReason}</p>}
    {error && <p role="alert" className="text-xs font-semibold text-danger">{error}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Link href="/restaurant-test/terms" className="text-xs font-semibold text-action">利用規約を別画面で読む</Link>
      <button
        type="button"
        disabled={!canSubmitTerms(readToEnd, checked) || saving}
        onClick={() => void agree()}
        className="rounded-control bg-accent-deep px-5 py-2.5 text-sm font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-40"
      >{saving ? '同意を記録中…' : '同意して次へ進む'}</button>
    </div>
  </div>
}
