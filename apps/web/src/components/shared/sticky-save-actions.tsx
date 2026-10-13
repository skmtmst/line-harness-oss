import { Children, cloneElement, isValidElement, type ReactNode } from 'react'
import { Save } from 'lucide-react'
import Button from './button'

type ActionChildren = { children?: ReactNode; 'aria-hidden'?: boolean | 'true' | 'false' }

function actionText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(actionText).join('')
  if (!isValidElement<ActionChildren>(node) || node.props['aria-hidden'] === true || node.props['aria-hidden'] === 'true') return ''
  return actionText(node.props.children)
}

/** Decorative marks belong to the bar; keep the authored label and its markup. */
function withoutDecorations(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return Children.map(node, withoutDecorations)
  if (!isValidElement<ActionChildren>(node)) return node
  if (node.type === 'svg' || node.props['aria-hidden'] === true || node.props['aria-hidden'] === 'true') return null
  if (node.props.children === undefined) return node
  return cloneElement(node, {}, withoutDecorations(node.props.children))
}

/** The idle primary save/create/publish action has one mark across forms. */
export function normalizeStickySaveActions(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return Children.map(node, normalizeStickySaveActions)
  if (!isValidElement<ActionChildren & { variant?: string; href?: unknown }>(node)) return node
  if (node.type === Button && node.props.variant === 'primary' && node.props.href === undefined
    && /(保存|登録|作る|つくって|動かす|変更|公開|発行|有効|追加|やり直す)/.test(actionText(node.props.children))) {
    return cloneElement(node, {}, <><Save size={16} aria-hidden="true" data-sticky-save-icon />{withoutDecorations(node.props.children)}</>)
  }
  if (node.props.children === undefined) return node
  const children = normalizeStickySaveActions(node.props.children)
  return children === node.props.children ? node : cloneElement(node, {}, children)
}
