'use client'

/*
 * ★V8 受信箱の頭の「対応ルール」（M0393 XqSvX の題の行・settings-2 の印）。
 *
 * 前は押すと友だち属性の「対応マーク」のページへ移っていた。受信箱で会話を
 * 見ている途中に別のページへ飛ぶのはおかしい（オーナー指摘）ので、その場で
 * 小窓を開き、対応マークと「いつ自動で変わるか」を見せる。直すのは小窓の下の
 * 「対応マークの設定を開く」から（そこだけがページを移る）。
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Settings2 } from 'lucide-react'
import MenuPortal from '@/components/shared/menu-portal'
import Button from '@/components/shared/button'
import { api, type SupportMarkListItem } from '@/lib/api'
import styles from './inbox-chat.module.css'

type Status = 'idle' | 'loading' | 'ready' | 'error'

/** いつ自動で付くか。自動の決まりの名前 → 受信時 → 手動だけ。 */
export function markRuleText(mark: SupportMarkListItem): string {
  if (mark.automationRules.length > 0) return mark.automationRules.map((rule) => rule.name).join('・')
  return mark.autoOnInbound ? '受信したとき自動で付く' : '手動だけ'
}

export default function InboxRulesPopover({ accountId }: { accountId: string | null }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [marks, setMarks] = useState<SupportMarkListItem[]>([])
  const [retry, setRetry] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !accountId) return
    let cancelled = false
    setStatus('loading')
    api.supportMarks.list(accountId).then((res) => {
      if (cancelled) return
      if (res.success) {
        setMarks(res.data)
        setStatus('ready')
      } else {
        setStatus('error')
      }
    }).catch(() => {
      if (!cancelled) setStatus('error')
    })
    return () => { cancelled = true }
  }, [open, accountId, retry])

  return (
    <div ref={wrapRef} className={styles.popWrap}>
      <Button
        type="button"
        size="compact"
        className={styles.popTrigger}
        aria-label="対応ルール"
        title="対応ルール"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
      >
        <Settings2 aria-hidden size={16} />
      </Button>
      <MenuPortal open={open} align="end" getAnchor={() => wrapRef.current} onClose={() => setOpen(false)}>
        <section role="dialog" aria-label="対応ルール" className={styles.pop}>
          <div>
            <p className={styles.popTitle}>対応ルール</p>
            <p className={styles.popNote}>対応マークと、自動で付くときの決まりです。</p>
          </div>
          {!accountId ? (
            <p className={styles.popNote}>LINEアカウントを選ぶと表示されます。</p>
          ) : status === 'loading' || status === 'idle' ? (
            <p className={styles.popNote}>読み込んでいます…</p>
          ) : status === 'error' ? (
            <div className={styles.popError}>
              <p>対応ルールを読み込めませんでした。</p>
              <button type="button" className={styles.popLink} onClick={() => setRetry((n) => n + 1)}>もう一度読み込む</button>
            </div>
          ) : marks.length === 0 ? (
            <p className={styles.popNote}>対応マークはまだありません。</p>
          ) : (
            <ul className={styles.popList}>
              {marks.map((mark) => (
                <li key={mark.id} className={styles.popRow}>
                  <span aria-hidden="true" className={styles.dot} style={{ backgroundColor: mark.color }} />
                  <span className={styles.popName}>{mark.name}</span>
                  <span className={styles.popRule} title={markRuleText(mark)}>{markRuleText(mark)}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href="/tags?tab=marks" className={styles.popLink}>対応マークの設定を開く</Link>
        </section>
      </MenuPortal>
    </div>
  )
}
