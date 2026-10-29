import { Children, cloneElement, isValidElement, type ReactNode, type ReactElement } from 'react'
import { Check, Save } from 'lucide-react'
import Button, { type ButtonProps } from './button'

type ActionChildren = { children?: ReactNode; hidden?: boolean; inert?: boolean; 'aria-hidden'?: boolean | 'true' | 'false' }

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

/** Reserve the save mark by default; an explicit role mark takes precedence. */
export function normalizeStickySaveActions(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return Children.map(node, normalizeStickySaveActions)
  if (!isValidElement<ActionChildren & { variant?: string; href?: unknown; icon?: ReactNode }>(node)) return node
  if (node.type === Button && node.props.variant === 'primary' && node.props.href === undefined
    && /(保存|登録|作る|つくって|動かす|変更|公開|発行|有効|追加|やり直す)/.test(actionText(node.props.children))) {
    const Mark = /保存/.test(actionText(node.props.children)) && !/(登録|作る|つくって|動かす|公開|発行|有効|追加|やり直す)/.test(actionText(node.props.children)) ? Check : Save
    return cloneElement(node, {}, <>{node.props.icon === undefined ? <Mark size={16} aria-hidden="true" data-sticky-save-icon /> : null}{withoutDecorations(node.props.children)}</>)
  }
  if (node.props.children === undefined) return node
  const children = normalizeStickySaveActions(node.props.children)
  return children === node.props.children ? node : cloneElement(node, {}, children)
}

/** 入力理由は操作の並びから外し、帯の下段へ一度だけ出す。押せない条件と読み上げはButtonに残す。 */
export function separateStickyInputReasons(node: ReactNode): { actions: ReactNode; reasons: string[] } {
  const reasons = new Set<string>()
  const visit = (child: ReactNode): ReactNode => {
    if (Array.isArray(child)) return Children.map(child, visit)
    if (!isValidElement<ActionChildren>(child)) return child
    if (child.props.hidden || child.props.inert || child.props['aria-hidden'] === true || child.props['aria-hidden'] === 'true') return child
    if (child.type === Button) {
      const button = child as ReactElement<ButtonProps>
      const props = button.props
      if (props.href === undefined && props.disabled && !props.hidden && !props.lockedReason && !props.busy && props.disabledReason) {
        reasons.add(props.disabledReason)
        return cloneElement(button, { disabledReason: undefined, 'aria-description': props.disabledReason })
      }
      return child
    }
    return child.props.children === undefined ? child : cloneElement(child, {}, visit(child.props.children))
  }
  const actions = visit(node)
  return { actions, reasons: [...reasons] }
}

/** 削除の入口は赤い文字だけにそろえ、同じ欄へ渡された副操作や配布操作は保つ。 */
export function normalizeStickyDestructiveActions(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return Children.map(node, normalizeStickyDestructiveActions)
  if (!isValidElement<ActionChildren & { variant?: string; icon?: ReactNode; textTone?: string; 'aria-label'?: string }>(node)) return node
  if (node.type === Button) {
    const text = actionText(node.props.children)
    const label = text || node.props['aria-label'] || ''
    if (/削除|(?<!取り|打ち)消す/.test(label)) {
      return cloneElement(node, { variant: 'text', textTone: 'danger', icon: undefined }, text ? withoutDecorations(node.props.children) : label)
    }
    return ['danger', 'danger-outline'].includes(node.props.variant ?? '') || node.props.textTone === 'danger'
      ? cloneElement(node, { variant: 'secondary', textTone: undefined }) : node
  }
  if (node.props.children === undefined) return node
  return cloneElement(node, {}, normalizeStickyDestructiveActions(node.props.children))
}
