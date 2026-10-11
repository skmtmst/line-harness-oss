import type { CSSProperties, ReactNode } from 'react'
import HelpTip from '@/components/shared/help-tip'
import StickyBar from '@/components/shared/sticky-bar'
import styles from './page-templates.module.css'

export interface PageHeadingProps {
  title: ReactNode
  subtitle?:ReactNode
  /** 認証画面では h1。管理画面内では外側の h1 に続く h2。 */
  titleAs?: 'h1' | 'h2'
  titleId?: string
  titleTabIndex?: number
  /** 既存の枠が外側の余白を持つときだけ指定。 */
  inset?: 'none'
  /** 題はすべて22/700/32。compact は題の周りの余白・間隔だけを詰める。 */
  headingSize?: 'regular' | 'compact' | 'large'
  /** 頭の上の余白を絵の値にする。渡さないときは共通の 24（`--tpl-head-pad-top`）のまま。 */
  padTop?: number
  /** 題と説明の間を絵の値にする。渡さないときは共通の 8（`--tpl-head-gap`）のまま。 */
  textGap?: number
  /*
   * 題を小さくする。`'sub'` は 18/700/27。
   * 決まりの板（`docs/v8-design-rules.md` 「文字の段」）はページの題を 22/700 と書くが、
   * ★V8 の絵では板の中の小さな板（例 デリバリー受注の「注文履歴・売上」「品切れ・在庫」）を
   * 18/700/27 で描いている。正本の順位は 使いやすさ → 絵 → 決まりの板 → 共通部品 なので
   * 絵に合わせる。渡さない画面はこれまでどおり 22/700/32 のまま。
   */
  titleSize?: 'sub'
  /** 説明の文字を本文の大きさ（13/20）にする。渡さないときは補足の 12/19 のまま。 */
  subtitleSize?: 'body'
  /** 詳細の説明とタブを詰める口。指定しない画面には効かない。 */
  bottomSpacing?: 'compact'
  help?: ReactNode
  /** 題の隣の状態の札・名前を変える操作。 */
  titleAccessory?: ReactNode
  /**
   * @deprecated ★V8 では描かない（オーナー 2026-10-08「全部消す」）。
   * 板の頭の「← 〇〇へ」は、上の帯のパンくず（usePageCrumbs）と下の帯の［キャンセル］に任せる。
   * 渡しても型が捨てる（画面ごとに消して回らないための受け口。呼び出し側は追って外す）。
   */
  identity?: ReactNode
  actions?: ReactNode
  /** 題と説明の下の行に置く、来た道の案内（★BG-B `qIp42` の `HLq5w`・`Y5UR7`）。 */
  crumbs?: ReactNode
  /**
   * 手順。型の共通部品 `<Steps>`（Fa8ED）を渡す。置き場所は1つだけ：題と説明のすぐ下・左寄せ・1行
   * （決まりの板 q1xNMz・2026-10-08 オーナー）。題の行の右には操作（actions）だけを置く。
   */
  steps?: ReactNode
  /** 説明が無い板で、題のすぐ下へ手順を詰める。 */
  stepsSpacing?: 'compact'
  /** 題と説明に続くタブ。渡した画面だけ頭の中へ置く。 */
  tabs?: ReactNode
}

/** 型の外に残るページの題も同じ文字の決まりを使う。窓・カードには使わない。 */
export function PageTitle({ children, as: Tag = 'h2', className }: {
  children: string; as?: 'h1' | 'h2'; className?: string
}) {
  return <Tag className={[styles.pageTitle, className].filter(Boolean).join(' ')} title={children} data-page-title>{children}</Tag>
}

/** 板の頭の寸法は型が持つ。操作・意味の説明は画面から渡す。 */
export function PageHeading({ title, subtitle, titleAs: HeadingTag = 'h2', titleId, titleTabIndex, help, titleAccessory, actions, crumbs, steps, tabs, headingSize, padTop, textGap, titleSize, subtitleSize, bottomSpacing, inset, stepsSpacing }: PageHeadingProps) {
  /* 戻る（identity）は描かない。戻るのは上の帯のパンくずと下の帯の［キャンセル］だけ（オーナー 2026-10-08）。 */
  /*
   * 絵の値を渡された分だけ、この頭の中だけに効く変数で下へ流す。`.heading`・`.title` は
   * すでにこの変数を読んでいるので、新しい選び方（セレクタ）は増えない。渡さない画面は
   * 共通の値のままで、他の板の見え方は変わらない。
   */
  const headStyle = padTop === undefined && textGap === undefined && titleSize === undefined
    ? undefined
    : ({
        ...(padTop === undefined ? null : { '--tpl-head-pad-top': `${padTop}px` }),
        ...(textGap === undefined ? null : { '--tpl-head-gap': `${textGap}px` }),
        ...(titleSize === 'sub' ? { '--tpl-title-size': '18px', '--tpl-title-lh': '27px' } : null),
      } as CSSProperties)
  return <header className={styles.heading} style={headStyle} data-template-region="heading" data-heading-inset={inset} data-heading-size={headingSize} data-subtitle-size={subtitleSize} data-bottom-spacing={bottomSpacing} data-has-steps={!!steps || undefined} data-steps-spacing={stepsSpacing} data-has-crumbs={!!crumbs || undefined}>
    <div className={styles.headingText}>
      <div className={styles.titleRow}><HeadingTag id={titleId} tabIndex={titleTabIndex} className={styles.title} title={typeof title === 'string' ? title : undefined}>{title}</HeadingTag>{titleAccessory}
        {help ? <HelpTip label={typeof title === 'string' ? `${title}の説明` : '画面の説明'}>{help}</HelpTip> : null}
      </div>
      {subtitle?<p className={styles.subtitle}>{subtitle}</p>:null}
      {tabs ? <div className={styles.headingTabs} data-template-region="heading-tabs">{tabs}</div> : null}
    </div>
    {crumbs ? <div className={styles.crumbs} data-template-region="crumbs">{crumbs}</div> : null}
    {steps ? <div className={styles.steps} data-template-region="steps">{steps}</div> : null}
    {actions ? <div className={styles.actions}>{actions}</div> : null}
  </header>
}

export function PageFrame({ kind, children, boardId, layout, standalone = false, hasFooter = false, skeleton = false }: {
  kind: string; children: ReactNode; boardId?: string; layout?: string; standalone?: boolean; hasFooter?: boolean; skeleton?: boolean
}) {
  return <div className={styles.frame} data-list-skeleton={skeleton ? 'templates' : undefined} data-page-template={kind} data-template-layout={layout} data-design-node={boardId} data-standalone={standalone || undefined} data-has-footer={hasFooter || undefined}>{children}</div>
}

/** 型が保存帯の置き場所と追従を持つ。画面は操作と状態だけを渡す。 */
export function PageFooter({ actions, status, presentation }: { actions: ReactNode; status?: ReactNode; presentation?: 'distribution' }) {
  return <div className={styles.footer} data-template-region="footer"><StickyBar actions={actions} status={status} presentation={presentation} /></div>
}
