import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = import.meta.dirname
const PAGE = readFileSync(join(ROOT, 'page.tsx'), 'utf8')
const ADS = readFileSync(join(ROOT, 'ad-integration.tsx'), 'utf8')
const CREATE = readFileSync(join(ROOT, 'new', 'page.tsx'), 'utf8')
const DETAIL = readFileSync(join(ROOT, 'detail', 'page.tsx'), 'utf8')
const SITE = readFileSync(join(ROOT, '..', '..', 'components', 'inflow-links', 'site-script.tsx'), 'utf8')

describe('V6 機能18の画面契約', () => {
  it('4つの役割を別のタブと画面に分ける', () => {
    expect(PAGE).toContain("{ key: 'links', label: '流入経路 24' }")
    expect(PAGE).toContain("{ key: 'script', label: 'サイトスクリプト' }")
    expect(PAGE).toContain("{ key: 'ads', label: '広告連携 3' }")
    expect(PAGE).toContain("{ key: 'connections', label: '広告とのつなぎ 5' }")
    expect(PAGE).toContain('<AdIntegration view="metrics" />')
    expect(PAGE).toContain('<AdIntegration view={adView} />')
    expect(ADS).toContain("type AdView = 'metrics' | 'connections' | 'history'")
  })

  it('各画面をPencilの実ノードと結び、未接続値を作らない', () => {
    expect(SITE).toContain('data-design-node="IhSBB"')
    expect(ADS).toContain('data-design-node="v0HaI"')
    expect(ADS).toContain('data-design-node="BuVDB"')
    expect(ADS).toContain('data-design-node="Im2b1"')
    expect(CREATE).toContain('designNode="TEVk8"')
    expect(DETAIL).toContain('data-design-node="JupxW"')
    expect(ADS).toContain('成果地点と、広告に返す名前の対応')
    expect(SITE).toContain('知らないドメインが1つあります')
  })

  it('押せない準備中UIを機能18から除く', () => {
    for (const source of [PAGE, ADS, CREATE, DETAIL, SITE]) {
      expect(source).not.toContain('準備中')
    }
  })

  it('作成後は発行済みURLを使える詳細へ進む', () => {
    expect(CREATE).toContain('saveLabel="発行してURLを受け取る"')
    expect(CREATE).toContain('successHref={(id) => `/inflow-links/detail?id=${id}`}')
    expect(CREATE).toContain('REF（URLに入る文字）')
    expect(CREATE).toContain('お客さまはこの順に進みます')
  })

  it('詳細にはこの経路から来た友だちと本人確認の導線がある', () => {
    expect(DETAIL).toContain('/api/analytics/ref/${encodeURIComponent(r.value.data.refCode)}')
    expect(DETAIL).toContain('この経路から来た友だち')
    expect(DETAIL).toContain('/friends/detail?id=${encodeURIComponent(friend.id)}')
  })
})
