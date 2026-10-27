import { Children, Fragment, cloneElement, createElement, isValidElement, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import Button, { type ButtonProps } from '@/components/shared/button'
import type { ReactElement } from 'react'

/** Only structural wrappers are flattened; stateful controls keep their own behavior. */
export function headingActionNodes(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap(node => {
    if (isValidElement<{ children?: ReactNode }>(node) && (node.type === Fragment || (node.type === 'div' || node.type === 'span') && !('className' in node.props) && !('style' in node.props))) return headingActionNodes(node.props.children)
    return [node]
  })
}

export function actionLabel(node: ReactNode): string {
  return Children.toArray(node).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child)
    return isValidElement<{ children?: ReactNode; 'aria-hidden'?: boolean }>(child) && !child.props['aria-hidden'] ? actionLabel(child.props.children) : ''
  }).join('')
}

/** Create-flow progress actions end with one right arrow, after the spoken label. */
export function normalizeProgressActionArrows(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return Children.map(node, normalizeProgressActionArrows)
  if (isValidElement<{ children?: ReactNode; className?: unknown; style?: unknown }>(node)
    && (node.type === Fragment || (node.type === 'div' || node.type === 'span') && node.props.className === undefined && node.props.style === undefined)) {
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

/** Supplementary saves keep their original callbacks and disabled conditions. */
export function splitFormActions(children: ReactNode) {
  const nodes = headingActionNodes(children)
  const secondary = nodes.filter((node): node is ReactElement<ButtonProps> => isValidElement<ButtonProps>(node) && node.type === Button
    && node.props.variant !== 'primary' && /複製|下書き|続けて作る/.test(actionLabel(node.props.children)))
  return { secondary, main: nodes.filter(node => !secondary.includes(node as ReactElement<ButtonProps>)) }
}
