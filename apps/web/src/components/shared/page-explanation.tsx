'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import HelpTip from './help-tip'
import styles from './page-explanation.module.css'

/*
 * 画面の説明は題の右の「？」1つ（洗い出し 74・決まり「説明文は？へ」）。
 * 灰の説明の帯と、青い「この画面の説明 ⌃」の開け閉めはやめた。
 * 題の「？」（help）と画面の説明（explanation）が両方ある時も、吹き出し1つにまとめる。
 */
type ExplanationState = { target: HTMLElement | null; setTarget: (node: HTMLElement | null) => void }
const Context = createContext<ExplanationState | null>(null)

/** 画面の説明の置き場。中の PageExplanationBody の中身を、題の「？」の吹き出しの中へ描く。 */
export function PageExplanationProvider({ children }: { pageKey: string; children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  return <Context.Provider value={{ target, setTarget }}>{children}</Context.Provider>
}

function ExplanationContent({ help, extra }: { help?: ReactNode; extra?: ReactNode }) {
  const context = useContext(Context)
  return <span data-screen-explanation="" className={styles.content}>
    {help ? <span className={styles.part}>{help}</span> : null}
    {extra ? <span className={styles.part}>{extra}</span> : null}
    {context ? <span ref={context.setTarget} className={styles.part} /> : null}
  </span>
}

/** 題の右の「？」。題の補足（help）と画面の説明を1つの吹き出しで出す。 */
export function PageExplanationTip({ help, extra }: { help?: ReactNode; extra?: ReactNode }) {
  return <HelpTip label="この画面の説明" className={styles.tip}><ExplanationContent help={help} extra={extra} /></HelpTip>
}

/** 見出しの横に置く「？」。中身は PageExplanationBody から読む。 */
export function PageExplanationToggle() {
  return <PageExplanationTip />
}

/** 画面の説明の中身。画面には帯を出さず、題の「？」の吹き出しへ渡す。 */
export function PageExplanationBody({ children }: { children: ReactNode; keepMounted?: boolean; inset?: 'notice' }) {
  const context = useContext(Context)
  // 置き場の箱（一覧の型の .explanation）は、中が隠れている時に消える。空の段の余白を残さない。
  // 中身は吹き出しが開いている間だけ、その中へ描く（値が変われば開いたまま新しい値になる）。
  return <><span hidden data-screen-explanation-body="" />{context?.target ? createPortal(children, context.target) : null}</>
}

/**
 * 見出しの「？」をまとめて出す。画面の説明がある時は「この画面の説明」1つ、
 * 題の補足だけの時はこれまでどおり「〇〇の説明」。
 */
export function PageHelp({ label, help, toggle, explanation }: { label: string; help?: ReactNode; toggle?: ReactNode; explanation?: ReactNode }) {
  if (toggle || explanation) return <PageExplanationTip help={help} extra={explanation} />
  return help ? <HelpTip label={label}>{help}</HelpTip> : null
}
