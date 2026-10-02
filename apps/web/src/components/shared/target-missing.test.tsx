import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import TargetMissing from './target-missing'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(HERE, name), 'utf8')

/**
 * ★V7「開き先がない」（設計ノード `x5cgUH`）。
 *
 * 赤い字だけ・ピンクの箱・灰色の文だけ・枠つきの箱とばらばらだった
 * 37画面を、1つの部品にそろえる。開き先が無いのは利用者の失敗では
 * ないので、赤・ピンク・主ボタン（緑の塗り）は使わない。
 */
describe('開き先がない（TargetMissing）', () => {
  it('3つの状態を言い分ける', () => {
    for (const kind of ['unspecified', 'not-found', 'error'] as const) {
      const html = renderToStaticMarkup(
        <TargetMissing kind={kind} title="見出し" description="説明" backHref="/templates" backLabel="一覧へ戻る" onRetry={() => {}} />,
      )
      expect(html, `${kind} の印が付いていない`).toContain(`data-target-missing="${kind}"`)
    }
  })

  it('状態ごとに違う印を出す', () => {
    const unspecified = renderToStaticMarkup(<TargetMissing kind="unspecified" title="t" description="d" />)
    const notFound = renderToStaticMarkup(<TargetMissing kind="not-found" title="t" description="d" />)
    const error = renderToStaticMarkup(<TargetMissing kind="error" title="t" description="d" />)
    // lucide の絵が3種とも違うことだけ見る（名前の決め打ちはしない）。
    expect(new Set([unspecified, notFound, error]).size).toBe(3)
  })

  it('ボタンは1つだけ。戻るか、もう一度読み込むか', () => {
    const back = renderToStaticMarkup(
      <TargetMissing kind="unspecified" title="t" description="d" backHref="/templates" backLabel="テンプレートの一覧へ戻る" />,
    )
    expect(back).toContain('テンプレートの一覧へ戻る')
    expect(back.match(/<a|<button/g)?.length).toBe(1)

    const retry = renderToStaticMarkup(
      <TargetMissing kind="error" title="t" description="d" onRetry={() => {}} />,
    )
    expect(retry).toContain('もう一度読み込む')
    expect(retry.match(/<a|<button/g)?.length).toBe(1)
  })

  it('見つからないときだけ、アカウント名を添えられる', () => {
    const withAccount = renderToStaticMarkup(
      <TargetMissing kind="not-found" title="t" description="削除されたかもしれません。" accountName="然-NEN-TEST" />,
    )
    expect(withAccount).toContain('いまの LINE アカウントは「然-NEN-TEST」です。')
    // 渡さなければ出さない。
    expect(
      renderToStaticMarkup(<TargetMissing kind="not-found" title="t" description="d" />),
    ).not.toContain('いまの LINE アカウントは')
    // 未指定・読み込めないでは出さない。
    expect(
      renderToStaticMarkup(
        <TargetMissing kind="unspecified" title="t" description="d" accountName="然-NEN-TEST" />,
      ),
    ).not.toContain('いまの LINE アカウントは')
  })

  it('読み込めなかったことだけ、その場で読ませる', () => {
    expect(renderToStaticMarkup(<TargetMissing kind="error" title="t" description="d" />)).toContain(
      'role="alert"',
    )
    expect(
      renderToStaticMarkup(<TargetMissing kind="unspecified" title="t" description="d" />),
    ).not.toContain('role="alert"')
    expect(
      renderToStaticMarkup(<TargetMissing kind="not-found" title="t" description="d" />),
    ).not.toContain('role="alert"')
  })

  it('赤・ピンク・緑の塗りを使わない', () => {
    const css = read('target-missing.module.css')
    expect(css).not.toMatch(/text-danger|danger-bg|status-danger/)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,6}/)
    const tsx = read('target-missing.tsx')
    // 主ボタン（緑の塗り）は使わない。副ボタンだけ。
    expect(tsx).not.toMatch(/variant="primary"/)
    expect(tsx).toContain('variant="secondary"')
  })
})
