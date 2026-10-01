import HelpTip from './help-tip'
import TextLink from './text-link'
import styles from './section-header.module.css'

/**
 * 段の題（Pencil ★V8 `CugIm`）。
 *
 * 板の中の一段の頭。題（15px/600）に、必要なら補足・「？」・
 * 右端の行き先リンク（→つき）を付ける。「？」は help-tip、
 * リンクは text-link の既存部品をそのまま使う。
 */
export default function SectionHeader({
  title,
  note,
  help,
  helpLabel,
  href,
  linkLabel,
}: {
  /** 段の題（例「最近の動き」） */
  title: React.ReactNode
  /** 題の右の小さな補足（例「直近30日」） */
  note?: React.ReactNode
  /** 「？」を押すと出る補足文。helpLabel とセットで渡す */
  help?: React.ReactNode
  /** 「？」の読み上げ名（例「最近の動きの説明」） */
  helpLabel?: string
  /** 右端に出す行き先リンクの URL。linkLabel とセットで渡す */
  href?: string
  /** 行き先リンクの文字（例「すべて見る」） */
  linkLabel?: string
}) {
  return (
    <div className={styles.root}>
      <h3 className={styles.title}>{title}</h3>
      {note ? <span className={styles.note}>{note}</span> : null}
      {help && helpLabel ? <HelpTip label={helpLabel}>{help}</HelpTip> : null}
      {href && linkLabel ? (
        <span className={styles.link}>
          <TextLink href={href}>{linkLabel}</TextLink>
        </span>
      ) : null}
    </div>
  )
}
