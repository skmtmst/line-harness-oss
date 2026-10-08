'use client'

/*
 * ③［テンプレートから選ぶ］の窓（絵 lLyFR の見出しの右）。統括のメッセージのひな形（テキスト・画像・カルーセル・
 * リッチメッセージ・クーポンなど）を名前で探して選ぶと、開いている吹き出しをそのひな形で置き換える。
 * まだ統括から送れない種類（質問・リサーチ・Flex）は選んでも置き換えず、理由を窓の中に出す。
 */
import { useEffect, useState } from 'react'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import SearchField from '@/components/shared/search-field'
import { hqTemplatesApi, type HqTemplateListItem } from '@/lib/hq-templates-api'
import styles from './create.module.css'

const KIND_NAME: Record<string, string> = {
  message: 'メッセージ', carousel: 'カルーセル', rich_message: 'リッチメッセージ', question: '質問', coupon: 'クーポン', research: 'リサーチ',
}

export default function HqTemplatePicker({ open, onClose, onPick }: {
  open: boolean
  onClose: () => void
  /** 読み込めたら null、読み込めない理由があれば文。 */
  onPick: (id: string) => Promise<string | null>
}) {
  const [list, setList] = useState<HqTemplateListItem[] | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || list) return
    let current = true
    void hqTemplatesApi.listByKind().then((rows) => { if (current) setList(rows) }).catch((caught) => { if (current) setLoadError(caught) })
    return () => { current = false }
  }, [open, list])

  const q = query.trim().toLowerCase()
  const rows = (list ?? []).filter((t) => !q || t.name.toLowerCase().includes(q) || (t.content_summary ?? '').toLowerCase().includes(q))

  const pick = async (id: string) => {
    setBusy(id); setError('')
    const why = await onPick(id)
    setBusy('')
    if (why) { setError(why); return }
    setQuery('')
    onClose()
  }

  return (
    <Dialog open={open} title="テンプレートから選ぶ" description="統括のテンプレートを選ぶと、開いているメッセージをその内容に置き換えます。" cancelLabel="閉じる" onCancel={() => { setError(''); onClose() }} error={error || undefined}>
      <div className={styles.picker}>
        <SearchField aria-label="テンプレート名・内容で探す" placeholder="テンプレート名・内容で探す" value={query} onChange={setQuery} onClear={() => setQuery('')} />
        {loadError && !list ? <ListState kind="error" error={loadError} onRetry={() => { setLoadError(null); setList(null) }} />
          : !list ? <ListState kind="loading" />
          : rows.length === 0 ? <p className={styles.pickerEmpty}>{list.length === 0 ? '統括のテンプレートがまだありません。「テンプレート」で作ってください。' : '当てはまるテンプレートがありません。'}</p>
          : (
            <ul className={styles.pickerList} aria-label="統括のテンプレート">
              {rows.map((t) => (
                <li key={t.id}>
                  <button type="button" className={styles.pickerRow} disabled={Boolean(busy)} onClick={() => void pick(t.id)}>
                    <strong title={t.name}>{t.name}</strong>
                    <small title={t.content_summary ?? undefined}>{[KIND_NAME[t.kind ?? 'message'] ?? 'メッセージ', t.content_summary].filter(Boolean).join(' ・ ')}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </div>
    </Dialog>
  )
}
