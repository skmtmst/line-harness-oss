/*
 * V6R-S3-c: 2ページ目以降を同時に取り、並びはページ順に戻す。
 * 途中でアカウントが替わったら、集めた行を返さない（#963）。
 */
import { describe, expect, it } from 'vitest'
import { fetchAllPages } from './fetch-all-pages'

function server(total: number, pageSize: number) {
  let inFlight = 0
  let maxInFlight = 0
  const offsets: number[] = []
  const fetchPage = async (offset: number) => {
    offsets.push(offset)
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    // 後ろのページほど早く返す（届く順とページ順が逆になる）
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, 20 - offset / pageSize)))
    inFlight -= 1
    const end = Math.min(offset + pageSize, total)
    return { requests: Array.from({ length: Math.max(0, end - offset) }, (_, i) => offset + i), total }
  }
  return { fetchPage, offsets, get maxInFlight() { return maxInFlight } }
}

describe('fetchAllPages（V6R-S3-c）', () => {
  it('2ページ目以降を同時に頼み、並びはページ順に戻す', async () => {
    const s = server(450, 100)
    const rows = await fetchAllPages(s.fetchPage, 100, () => true)
    expect(rows).toEqual(Array.from({ length: 450 }, (_, i) => i))
    expect(s.offsets).toEqual([0, 100, 200, 300, 400])
    // 1ページ目のあと、残り4ページは同時に飛んでいる
    expect(s.maxInFlight).toBe(4)
  })

  it('1ページで収まれば1回だけ', async () => {
    const s = server(40, 100)
    expect(await fetchAllPages(s.fetchPage, 100, () => true)).toHaveLength(40)
    expect(s.offsets).toEqual([0])
  })

  it('空なら1回だけで、空を返す', async () => {
    const s = server(0, 100)
    expect(await fetchAllPages(s.fetchPage, 100, () => true)).toEqual([])
    expect(s.offsets).toEqual([0])
  })

  it('1ページ目のあとにアカウントが替わったら、残りを頼まず null を返す', async () => {
    const s = server(450, 100)
    expect(await fetchAllPages(s.fetchPage, 100, () => false)).toBeNull()
    expect(s.offsets).toEqual([0])
  })
})
