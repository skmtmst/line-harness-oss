// V7の部品を基準コミットと現在の実装でSSRし、Playwrightで同じCSS環境で比べる。
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import * as lucide from 'lucide-react'
import { it, expect } from 'vitest'
import RadioCard from '@/components/shared/radio-card'
import CheckCard from '@/components/shared/check-card'
import { Toast } from '@/components/shared/toast'
import HelpTip from '@/components/shared/help-tip'
import Notice from '@/components/shared/notice'
import ListState from '@/components/shared/list-state'
import Dialog from '@/components/shared/dialog'
import LinePreview from '@/components/shared/line-preview'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import * as overlays from '@/components/shared/overlay-utils'
import * as events from '@/lib/events'
import * as errorCopy from '@/components/shared/api-error-message'
import radioCss from '@/components/shared/radio-card.module.css'
import checkCss from '@/components/shared/check-card.module.css'
import toastCss from '@/components/shared/toast.module.css'
import helpCss from '@/components/shared/help-tip.module.css'
import noticeCss from '@/components/shared/notice.module.css'
import listCss from '@/components/shared/list-state.module.css'
import dialogCss from '@/components/shared/dialog.module.css'
import lineCss from '@/components/shared/line-preview.module.css'
import buttonCss from '@/components/shared/button.module.css'
import iconCss from '@/components/shared/icon-button.module.css'

const noop = () => {}
const base = '4b1cd841318a66b265a6fb64dbe25baa4106b1b6'
const cssMaps: Record<string, Record<string, string>> = {
  'radio-card': radioCss, 'check-card': checkCss, toast: toastCss, 'help-tip': helpCss,
  notice: noticeCss, 'list-state': listCss, dialog: dialogCss, 'line-preview': lineCss,
  button: buttonCss, 'icon-button': iconCss,
}
const sourcePath = (name: string, extension: string) => `apps/web/src/components/shared/${name}.${extension}`
const read = (name: string, extension: string, old: boolean) => old
  ? execFileSync('git', ['show', `${base}:${sourcePath(name, extension)}`], { encoding: 'utf8' })
  : readFileSync(`../../${sourcePath(name, extension)}`, 'utf8')
function oldModule(name: string): Record<string, unknown> {
  const code = ts.transpileModule(read(name, 'tsx', true), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const legacyModule = { exports: {} }
  const require = (id: string) => {
    if (id.endsWith('.module.css')) return { __esModule: true, default: cssMaps[name] }
    if (id === 'react') return React
    if (id === 'react/jsx-runtime') return jsxRuntime
    if (id === 'react-dom') return { createPortal: (value: unknown) => value }
    if (id === 'lucide-react') return lucide
    if (id === './button') return { __esModule: true, default: Button }
    if (id === './icon-button') return { __esModule: true, default: IconButton }
    if (id === './help-tip') return { __esModule: true, default: HelpTip }
    if (id === './overlay-utils') return overlays
    if (id === '@/lib/events') return events
    if (id === './api-error-message') return errorCopy
    if (id === './target-missing') return { __esModule: true, default: () => null }
    throw new Error(`未対応の参照: ${id}`)
  }
  new Function('require', 'module', 'exports', code)(require, legacyModule, legacyModule.exports)
  return legacyModule.exports
}
function sheet(old: boolean) {
  return Object.entries(cssMaps).map(([name, map]) => {
    const css = read(name, 'module.css', old)
    return css.replace(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g, (all, key) => map[key] ? `.${map[key]}` : all)
  }).join('\n')
}
function samples(old: boolean) {
  const R = old ? oldModule('radio-card').default as typeof RadioCard : RadioCard
  const C = old ? oldModule('check-card').default as typeof CheckCard : CheckCard
  const T = old ? oldModule('toast').Toast as typeof Toast : Toast
  const H = old ? oldModule('help-tip').default as typeof HelpTip : HelpTip
  const N = old ? oldModule('notice').default as typeof Notice : Notice
  const L = old ? oldModule('list-state').default as typeof ListState : ListState
  const D = old ? oldModule('dialog').default as typeof Dialog : Dialog
  const P = old ? oldModule('line-preview').default as typeof LinePreview : LinePreview
  return <div className="v7-fixtures" style={{ width: 640, padding: 20, display: 'grid', gap: 20, background: 'white' }}>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <R name="v7-radio" value="on" checked onChange={noop} title="タグで絞る" note="付いているタグで選ぶ" />
      <R name="v7-radio" value="off" checked={false} onChange={noop} title="タグで絞る" note="付いているタグで選ぶ" />
    </div>
    <C checked onChange={noop} title="ブロック中の人を除く" note="ブロック・非表示の17人には送りません" />
    <T item={{ tone: 'success', message: '保存しました', actionLabel: '元に戻す', onAction: noop }} />
    <T item={{ tone: 'error', message: '保存できませんでした', actionLabel: 'もう一度', onAction: noop }} />
    <H label="補足">説明</H>
    <N tone="info" message="作成しただけでは配信されません。" />
    <L kind="empty" title="まだタグがありません" description="友だちを分けるときに使います" action={<Button variant="primary">タグを作る</Button>} />
    <D open modal={false} title="担当者を招待する" description="できることを決めます" onCancel={noop} onConfirm={noop}><p>入力内容</p></D>
    <P accountName="然 - NEN -" caption="今日"><p>LINE本文</p></P>
  </div>
}
it('基準コミットと現在のV7見本を、同じ書体とCSS層で比較できる形に出す', () => {
  const exportHtml = readFileSync('./out/v8-parts.html', 'utf8')
  const rootClass = exportHtml.match(/<html[^>]*class="([^"]+)"/)?.[1] ?? ''
  const links = [...exportHtml.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/g)].map(match => match[0]).join('')
  expect(links).not.toBe('')
  for (const old of [true, false]) {
    const html = `<!doctype html><html lang="ja" data-theme="v7" class="${rootClass}"><head><meta charset="UTF-8">${links}<style>${sheet(old)}</style></head><body class="font-sans text-ink">${renderToStaticMarkup(samples(old))}</body></html>`
    writeFileSync(`/tmp/lh-cards-v7-${old ? 'before' : 'after'}.html`, html)
  }
})
