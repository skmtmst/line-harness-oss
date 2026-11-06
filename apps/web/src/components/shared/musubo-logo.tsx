import styles from './musubo-logo.module.css'

/** 公式ロゴを、透過余白を除いた表示サイズで共通して使う。 */
export default function MusuboLogo({ size = 'auth' }: { size?: 'auth' | 'ops' | 'mobile' | 'staff' }) {
  return <span className={styles.viewport} data-size={size}>
    {/* eslint-disable-next-line @next/next/no-img-element -- 提供されたロゴを加工せず共通表示する */}
    <img className={styles.image} src="/brand/musubo-color.png" width={3020} height={890} alt="musubo" />
  </span>
}
