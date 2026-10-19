import CodeBlock from './code-block'
import { Skeleton } from './skeleton'
import styles from './totp-qr.module.css'

/** : QR on the left, app instructions and manual key on the right. */
export default function TotpQr({ qr, manualKey }: { qr: string; manualKey: string }) {
  return <div className={styles.row}>
    {qr ? (
      // eslint-disable-next-line @next/next/no-img-element -- locally generated data URI
      <img src={qr} alt="認証アプリ登録用のQRコード" width={140} height={140} />
    ) : <Skeleton className={styles.qr} />}
    <div className={styles.instructions}><p>認証アプリで読み取ってください</p><p>読み取れないときは、このキーを手で入力</p><CodeBlock>{manualKey}</CodeBlock></div>
  </div>
}
