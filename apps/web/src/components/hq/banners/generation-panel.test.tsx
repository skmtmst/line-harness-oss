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
