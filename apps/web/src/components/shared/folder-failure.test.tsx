// @vitest-environment happy-dom
/*
 * フォルダの保存・消すの失敗の言葉（2026-10-09 オーナー：理由が分からず「保存できませんでした」だけだった）と、
 * 窓の中の知らせが下のボタンに重ならない置き方（本文の中・ボタンの帯より前・窓が伸びる）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { describeFolderFailure } from './folder-failure'
import FolderEditorDialog from './folder-editor-dialog'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const here = dirname(fileURLToPath(import.meta.url))

describe('フォルダの失敗の言葉', () => {
  it('理由ごとに言い分ける', () => {
    expect(describeFolderFailure(new ApiError(409, 'x', 'VERSION_CONFLICT')).message).toBe('ほかの人が先に直しました。最新の内容を読み込みました。もう一度保存してください。')
    expect(describeFolderFailure(new ApiError(409, 'x', 'VERSION_CONFLICT'), 'delete').kind).toBe('conflict')
    const name = describeFolderFailure(new ApiError(409, 'x', 'FOLDER_NAME_CONFLICT'))
    expect(name.kind).toBe('name')
    expect(name.nameError).toBe('同じ名前のフォルダがあります。')
    expect(describeFolderFailure(new ApiError(404, 'x', 'NOT_FOUND')).message).toBe('このフォルダは消されています。')
    expect(describeFolderFailure(new ApiError(422, 'x', 'INVALID_FOLDER_COLOR')).kind).toBe('color')
    expect(describeFolderFailure(new ApiError(403, 'x', 'FORBIDDEN')).kind).toBe('forbidden')
    expect(describeFolderFailure(new TypeError('Failed to fetch')).message).toBe('つながりませんでした。もう一度お試しください。')
  })

  it('読めない理由も状態番号と理由の符号を小さく添える', () => {
    expect(describeFolderFailure(new ApiError(500, 'x', 'UNAVAILABLE')).message).toBe('フォルダを保存できませんでした。（状態 500・UNAVAILABLE）')
    expect(describeFolderFailure(new ApiError(502, 'x'), 'delete').message).toBe('フォルダを消せませんでした。（状態 502）')
  })
})

describe('フォルダの窓の知らせの置き方', () => {
  it('知らせは本文の中（名前と色の下）にあり、ボタンの帯より前。ボタンの帯の中には入らない', async () => {
    document.documentElement.dataset.theme = 'v8'
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(<FolderEditorDialog open title="フォルダを直す" name="テスト" onNameChange={() => {}} color={null} onColorChange={() => {}}
        error="フォルダを保存できませんでした。（状態 500）" confirmLabel="保存する" cancelLabel="やめる" onCancel={() => {}} onConfirm={() => {}} />)
    })
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    const alert = dialog.querySelector('[data-folder-dialog-error]') as HTMLElement
    const save = [...dialog.querySelectorAll('button')].find((b) => b.textContent === '保存する') as HTMLElement
    expect(alert).not.toBeNull()
    // 名前の欄と同じ本文の箱の中
    expect(alert.parentElement?.querySelector('[data-folder-name-color]')).not.toBeNull()
    // ボタンより前で、ボタンを含む箱の外
    expect(alert.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(save.closest('div')?.contains(alert)).toBe(false)
    // 窓の下の帯の位置にある Dialog の知らせ欄は使わない（二重に出さない）
    expect(dialog.querySelectorAll('[role="alert"]')).toHaveLength(1)
    act(() => root.unmount())
    host.remove()
    delete document.documentElement.dataset.theme
  })

  it('知らせは流れの中に置き、浮かせたり負の余白で下へ食い込ませたりしない', () => {
    const css = readFileSync(join(here, 'folder-editor-dialog.module.css'), 'utf8')
    const rule = css.match(/\.error \{[^}]*\}/)?.[0] ?? ''
    expect(rule).toContain('margin: 0')
    expect(rule).not.toMatch(/position:\s*(absolute|fixed)/)
    expect(rule).not.toMatch(/margin[^;]*-/)
  })
})
