import { Crop } from 'lucide-react'

import styles from './export-size-chip.module.css'

/**
 * **書き出す大きさの札。** 押す前に「何の大きさで出るか」を見せる。
 *
 * 絵は ★BG-B `qIp42` の下部追従バー `X2oLn` の中ほど——`WDJak`「中 サイズ確認」。
 * 薄い緑の丸い札に、切り抜きの絵（`c5NlW`）と「1040 × 1040 で書き出します」
 * （`GcuH5`）。v7（`app/hq/banners/project/page.tsx`）と
 * v8（`v8/hq-banners/project.tsx`）の両方がこの札を使う。
 *
 * 文言は決め打ちしない。`exportSizeText()` が選択中の用途の寸法から組む。
 * **用途を選ぶまでは何も描かない**（寸法が決まらないため）。空文字で `null` を
 * 返すので、呼ぶ側で出し分けを書かなくてよい。
 */
export default function ExportSizeChip({ text }: { text: string }) {
  if (!text) return null
  return (
    <span className={styles.chip}>
      <Crop aria-hidden="true" className={styles.icon} />
      {text}
    </span>
  )
}
