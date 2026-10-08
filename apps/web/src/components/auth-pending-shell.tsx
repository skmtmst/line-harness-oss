import { Skeleton } from './shared/skeleton'
import { PageFrame } from './templates/page-frame'
import shell from './app-shell.module.css'
import sidebar from './layout/sidebar.module.css'
import styles from './auth-pending-shell.module.css'

const NAV_WIDTHS = ['72%', '58%', '66%', '50%', '62%', '70%', '54%', '64%']
const ROW_WIDTHS = ['40%', '92%', '86%', '90%', '78%', '88%']

/**
 * ログインの確認を初めて待つあいだ（開いた直後・ログイン直後）の外枠。
 *
 * 以前は灰色の地の真ん中に緑のくるくるだけだった（2026-10-08 オーナー）。
 * 左メニュー・上の帯・白い板の骨組みで待ち、確認が済んだら本物と入れ替える。
 * 書き出した HTML にもこの形が入るので、読み込み中の最初の一瞬も同じ見え方になる。
 * 中身は出さない（確認が済むまで画面の情報・権限は見せない）。
 */
export default function AuthPendingShell() {
  return (
    <div className={shell.shell} data-auth-pending="" role="status" aria-busy="true" aria-label="読み込み中">
      <div className={shell.workspace}>
        <div className={sidebar.desktop} aria-hidden="true">
          <div className={styles.brand}>
            <Skeleton width={36} height={36} />
            <Skeleton width={120} height={14} />
          </div>
          <div className={styles.nav}>
            {NAV_WIDTHS.map((width, index) => <Skeleton key={index} width={width} height={14} />)}
          </div>
        </div>
        <div className={shell.side}>
          <div className={styles.topBar} aria-hidden="true" />
          <div className={shell.main}>
            <div className={shell.content}>
              <PageFrame kind="pending">
                <div className={styles.rows} aria-hidden="true">
                  {ROW_WIDTHS.map((width, index) => <Skeleton key={index} width={width} height={index === 0 ? 22 : 16} />)}
                </div>
              </PageFrame>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
