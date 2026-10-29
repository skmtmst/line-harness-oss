// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PostImageCrop } from './post-image-crop'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const source = { url: 'https://example.test/photo.jpg', name: 'photo.jpg' }

describe('投稿画像の切り取り確認窓', () => {
  it.each(['google', 'instagram'] as const)('%s 用の題と取り消し・確定を出す', (target) => {
    render(<PostImageCrop target={target} source={source} onClose={vi.fn()} onConfirm={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: `${target === 'google' ? 'Google' : 'Instagram'}用画像の切り取り位置を確認` })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '閉じる' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'この位置で確定' })).toBeTruthy()
  })

  it('確定は画像の読み込み前は押せない', () => {
    render(<PostImageCrop target="google" source={source} onClose={vi.fn()} onConfirm={vi.fn()} />)
    expect((screen.getByRole('button', { name: 'この位置で確定' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('キャンセル・閉じる・Escape・背景で取り消す', () => {
    const onClose = vi.fn()
    const { container, unmount } = render(<PostImageCrop target="google" source={source} onClose={onClose} onConfirm={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
    const backdrop = container.querySelector('div[role="presentation"]') as HTMLElement
    fireEvent.mouseDown(backdrop, { target: backdrop })
    expect(onClose).toHaveBeenCalledTimes(4)
    unmount()
  })
})
