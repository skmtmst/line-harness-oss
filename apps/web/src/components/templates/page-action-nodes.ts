import { Children, Fragment, cloneElement, createElement, isValidElement, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import Button, { type ButtonProps } from '@/components/shared/button'
import type { ReactElement } from 'react'

function structuralWrapper(node: ReactNode): node is ReactElement<{ children?: ReactNode }> {
  return isValidElement<{ children?: ReactNode }>(node) && (node.type === Fragment || (node.type === 'div' || node.type === 'span') && Object.keys(node.props).every(key => key === 'children'))
}

/** 表示条件や操作を持たない包みだけを展開する。 */
export function headingActionNodes(children: ReactNode): ReactNode[] {
  return flattenActionNodes(children, '')
}
function flattenActionNodes(children: ReactNode, parentKey: string): ReactNode[] {
  return Children.toArray(children).flatMap((node, index) => {
    const key = `${parentKey}/${isValidElement(node) ? node.key ?? index : index}`
    if (structuralWrapper(node)) return flattenActionNodes(node.props.children, key)
    return [isValidElement(node) ? cloneElement(node, { key }) : node]
  })
}

export function actionLabel(node: ReactNode): string {
  return Children.toArray(node).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child)
    return isValidElement<{ children?: ReactNode; 'aria-hidden'?: boolean }>(child) && !child.props['aria-hidden'] ? actionLabel(child.props.children) : ''
  }).join('')
}

/** 作成フローの進む操作は、名前の後ろに右矢印を1つ置く。 */
export function normalizeProgressActionArrows(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return Children.map(node, normalizeProgressActionArrows)
  if (structuralWrapper(node)) {
    const children = normalizeProgressActionArrows(node.props.children)
    return children === node.props.children ? node : cloneElement(node, {}, children)
  }
  if (!isValidElement<ButtonProps>(node) || node.type !== Button) return node
  const label = actionLabel(node.props.children)
  if (!/(次へ|進む)$/.test(label)) return node
  const children = Children.toArray(node.props.children)
  const arrow = children.find(child => isValidElement(child) && child.type === ArrowRight)
  const content = children.filter(child => !(isValidElement(child) && child.type === ArrowRight))
  return cloneElement(node, {}, [...content, arrow ?? createElement(ArrowRight, { key: 'progress-arrow', size: 16, 'aria-hidden': true })])
}

/** 補助の保存を取り出し、元の処理と無効条件を保つ。 */
export function splitFormActions(children: ReactNode) {
  const nodes = headingActionNodes(children)
  const secondary = nodes.filter((node): node is ReactElement<ButtonProps> => isValidElement<ButtonProps>(node) && node.type === Button
    && node.props.variant !== 'primary' && !/danger/.test(node.props.variant ?? '') && /複製|下書き.*保存|続けて作る/.test(actionLabel(node.props.children)))
  return { secondary, main: nodes.filter(node => !secondary.includes(node as ReactElement<ButtonProps>)) }
}
