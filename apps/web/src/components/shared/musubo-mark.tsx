import styles from './musubo-mark.module.css'

/** 公式ロゴから切り出したマーク。LINE の見本では送り主名が隣にあるため装飾扱い。 */
export default function MusuboMark() {
  // eslint-disable-next-line @next/next/no-img-element -- 提供された公式マークをそのまま表示する
  return <img className={styles.mark} src="/icons/icon-192.png" width={192} height={192} alt="" aria-hidden="true" />
}
