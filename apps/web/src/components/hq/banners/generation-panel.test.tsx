// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import GenerationPanel from './generation-panel'
import { EMPTY_GENERATION_INPUT, type BannerPreset } from '@/lib/hq-banners'

/*
 * R120: 生成画像を用途の指定寸法へ整える。生成は3種類の大きさだけなので、
 * 用途を選ぶと切り抜きの位置（中央・上・下）を選べるプレビューを出す。
 */
afterEach(cleanup)

const presets: BannerPreset[] = [
  { key: 'line_rich_menu_small', group: 'line', label: 'リッチメニュー（小）', note: '2500×843。高さが半分のメニュー', aspectRatio: '3:1', apiSize: '1536x1024', targetWidth: 2500, targetHeight: 843 },
  { key: 'sns_story', group: 'sns', label: 'ストーリー', note: '1080×1920（9:16）', aspectRatio: '9:16', apiSize: '1024x1536', targetWidth: 1080, targetHeight: 1920 },
]

function open(presetKey = 'line_rich_menu_small') {
  const onChange = vi.fn()
  render(
    <GenerationPanel
      presets={presets}
      maxCount={4}
      value={{ ...EMPTY_GENERATION_INPUT, presetKey }}
      onChange={onChange}
      reference={null}
      onPickReference={() => undefined}
      onUploadReference={() => undefined}
    />,
  )
  return onChange
}

describe('R120 切り抜きの位置とプレビュー', () => {
  it('用途を選ぶと中央・上・下を選べ、用途の寸法が出る', () => {
    open()
    expect((screen.getByRole('radio', { name: '中央' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: '上' }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('radio', { name: '下' }) as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText('生成後にこの範囲で2500×843に整えます')).toBeTruthy()
  })

  it('選ぶと親へ伝わる', () => {
    const onChange = open()
    fireEvent.click(screen.getByRole('radio', { name: '下' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cropPosition: 'bottom' }))
  })

  it('用途が未選択のときは出ない', () => {
    open('')
    expect(screen.queryByRole('radio', { name: '中央' })).toBeNull()
    expect(screen.queryByText(/生成後にこの範囲で/)).toBeNull()
  })
})

/*
 * ★BG-B `xy4EW`: 出力サイズ。LINE の規格をカードで並べ、普段使わない
 * Instagram・X・OGP などは「ほかの用途から選ぶ」の後ろへ畳む。
 */
describe('出力サイズ（★BG-B xy4EW）', () => {
  it('LINE の規格をカードで並べ、ほかの用途は畳む', () => {
    open()
    // 見出しの「出力サイズ」（同じ言葉を読み上げ用の legend にも入れている）
    expect(screen.getByText('出力サイズ', { selector: 'span' })).toBeTruthy()
    expect(screen.getByText('LINEの規格から選ぶ')).toBeTruthy()
    // LINE の規格はカード、寸法を添える
    const card = screen.getByRole('radio', { name: /リッチメニュー（小）/ }) as HTMLInputElement
    expect(card.checked).toBe(true)
    expect(screen.getByText('2500 × 843')).toBeTruthy()
    // 畳んだ側は描かない（プルダウンの空選択肢も出さない）
    expect(screen.queryByRole('radio', { name: /ストーリー/ })).toBeNull()
    expect(screen.queryByText('用途を選んでください')).toBeNull()
  })

  it('「ほかの用途から選ぶ」を押すと SNS の規格も並び、選ぶと親へ伝わる', () => {
    const onChange = open()
    fireEvent.click(screen.getByRole('button', { name: /ほかの用途から選ぶ/ }))
    fireEvent.click(screen.getByRole('radio', { name: /ストーリー/ }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ presetKey: 'sns_story' }))
  })

  it('畳んだ側が選ばれている状態なら、開いた状態で出す', () => {
    open('sns_story')
    expect((screen.getByRole('radio', { name: /ストーリー/ }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByRole('button', { name: /ほかの用途から選ぶ/ })).toBeNull()
  })
})

/*
 * ★BG-B `KkTNS` / 補足 `pQlYK`: 色は4つの役割で指定する。承認済みデザインの
 * 並び（ベース・メイン・サブ・強調）と言葉をそのまま出していることを押さえる。
 */
describe('カラーの4つの役割（★BG-B KkTNS）', () => {
  it('4つの役割が承認どおりの順で並び、補足の文も出る', () => {
    open()
    expect(screen.getByText('カラー')).toBeTruthy()
    expect(screen.getByText('4つの役割で指定します')).toBeTruthy()
    for (const label of ['ベースカラー', 'メインカラー', 'サブカラー', '強調カラー']) {
      expect(screen.getByRole('button', { name: `${label}（今の色 指定なし）` })).toBeTruthy()
    }
    expect(screen.getByText('色の決め方')).toBeTruthy()
    expect(screen.getByText(/ベースは背景、メインは主役、サブは差し色、強調は特に目立たせたい文字/)).toBeTruthy()
  })

  it('役割ごとに選んだ色が、その役割だけに入る', () => {
    const onChange = open()
    fireEvent.click(screen.getByRole('button', { name: 'サブカラー（今の色 指定なし）' }))
    fireEvent.click(screen.getByRole('option', { name: '#06c755' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ subColor: '#06c755', baseColor: null, mainColor: null, accentColor: null }))
  })
})
