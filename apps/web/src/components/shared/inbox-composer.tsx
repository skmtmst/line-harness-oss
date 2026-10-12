import type { HTMLAttributes, Ref, TextareaHTMLAttributes } from 'react'
import Button, { type ButtonProps } from './button'
import styles from './inbox-composer.module.css'

type PartProps = HTMLAttributes<HTMLDivElement>
export function InboxComposerTools(props: PartProps) { return <div {...props} className={styles.tools} /> }
export function InboxInputBox(props: PartProps) { return <div {...props} className={styles.input} /> }
export function InboxDraftArea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) { return <textarea {...props} className={styles.draft} /> }
export function InboxDraftCount(props: HTMLAttributes<HTMLParagraphElement>) { return <p {...props} className={styles.count} /> }
export function InboxComposerBottom(props: PartProps) { return <div {...props} className={styles.bottom} /> }
export function InboxComposerActions(props: HTMLAttributes<HTMLSpanElement>) { return <span {...props} className={styles.actions} /> }
export function InboxToolButton(props: ButtonProps) { return <Button {...props} variant="secondary" size="compact" className={styles.tool} /> }
