// @vitest-environment happy-dom
/* #820: 版の比べる（汎用）。消えた行に−、足した行に＋。 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import VersionCompare, { diffLines } from './version-compare'

afterEach(() => cleanup())

describe('版の比べる', () => {
  it('消えた行と足した行に印が付く', () => {
    render(<VersionCompare before={'報酬を 5pt に\n上限：1か月 3枚まで'} after={'報酬を 10pt に\n上限：1か月 3枚まで'} />)
    expect(screen.getByText('－')).toBeTruthy()
    expect(screen.getByText('＋')).toBeTruthy()
    expect(screen.getByText('上限：1か月 3枚まで')).toBeTruthy()
  })

  it('同じ中身は変わった所なしと出す', () => {
    render(<VersionCompare before="同じ本文" after="同じ本文" />)
    expect(screen.queryByText('－')).toBeNull()
    expect(screen.queryByText('＋')).toBeNull()
  })

  it('diffLines は前→後の順で消えた・足したを並べる', () => {
    const rows = diffLines('a\nb', 'a\nc')
    expect(rows.map((r) => r.kind)).toEqual(['same', 'removed', 'added'])
  })
})
