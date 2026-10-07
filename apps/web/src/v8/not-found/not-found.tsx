'use client'

/*
 * ★V8 見つからない画面（板 `Nx5dz`・V8.pen の修正案「採用 2026-10-07 リリース前」）。
 * 白い板の真ん中に、印（絵の file-question は丸の？で描かれているので CircleHelp）・題・説明・［前のページへ戻る］（副）［ダッシュボードへ］（主）。
 * 画面名は上の帯（ホーム › ページが見つかりません）が持つので、ここの題は h2。
 */
import { CircleHelp } from 'lucide-react'
import { useRouter } from 'next/navigation'
import Button from '@/components/shared/button'
import styles from './not-found.module.css'

export default function NotFoundV8() {
  const router = useRouter()
  const goBack = () => {
    // 直接開いた（戻る先が無い）ときは、ダッシュボードへ。
    if (typeof window !== 'undefined' && window.history.length > 1) router.back()
    else router.push('/')
  }
  return (
    <div className={styles.board} data-design-node="Nx5dz">
      <section className={styles.box} aria-labelledby="not-found-title">
        <span className={styles.mark} aria-hidden="true"><CircleHelp /></span>
        <h2 id="not-found-title" className={styles.title}>ページが見つかりません</h2>
        <p className={styles.description}>URL がまちがっているか、ページが移動・削除された可能性があります。</p>
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={goBack}>前のページへ戻る</Button>
          <Button href="/" variant="primary">ダッシュボードへ</Button>
        </div>
      </section>
    </div>
  )
}
