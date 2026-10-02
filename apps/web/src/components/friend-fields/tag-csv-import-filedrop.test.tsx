// @vitest-environment happy-dom
/*
 * タグCSV取り込みのファイル選択（★V7 NQMnx への置き換え）。
 * 落とす場所で選ぶ → 行に名前・件数・大きさ・外すが出る → 外すと消える。
 * 大きさの上限と誤り文は変えない。
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TagCsvImportDialog from './tag-csv-import-dialog'

vi.mock('@/lib/api', () => ({
  api: { tags: { importPreview: vi.fn(), importCsv: vi.fn() } },
}))

afterEach(() => cleanup())

function openDialog() {
  render(<TagCsvImportDialog open onClose={() => {}} onCompleted={() => {}} />)
}

function chooseFile(name: string, content: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement | null
  if (!input) throw new Error('file input が見つかりません')
  fireEvent.change(input, { target: { files: [new File([content], name, { type: 'text/csv' })] } })
}

describe('タグCSV取り込みのファイル選択（★V7 NQMnx）', () => {
  it('落とす場所と「CSVを選ぶ」ボタンが出る', () => {
    openDialog()
    expect(screen.getByText('ここにCSVを置く')).not.toBeNull()
    expect(screen.getByText('UTF-8・最大500件・1MB以下')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'CSVを選ぶ' })).not.toBeNull()
  })

  it('選んだCSVは行に名前・件数・大きさと外すが出る', async () => {
    openDialog()
    chooseFile('タグまとめ.csv', 'タグ名,フォルダ\nVIP,会員\n常連,会員\n')
    expect(await screen.findByText('タグまとめ.csv')).not.toBeNull()
    expect(screen.getByText('2件・1KB')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '「タグまとめ.csv」を外す' }))
    expect(screen.queryByText('タグまとめ.csv')).toBeNull()
  })

  it('大きすぎるCSVは誤りの行に出て、文は重ねて出さない', async () => {
    openDialog()
    chooseFile('大きすぎる.csv', `${'あ'.repeat(1024 * 1024 + 1)}`)
    expect(await screen.findByText('CSVは1MB以下にしてください')).not.toBeNull()
    expect(screen.getAllByText('CSVは1MB以下にしてください')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '「大きすぎる.csv」を外す' })).not.toBeNull()
  })
})
