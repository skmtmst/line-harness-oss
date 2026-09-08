import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const API = read('./api.ts')
const CONTENTS_ROUTE = read('../../../worker/src/routes/contents.ts')
const AUTOMATIONS_PAGE = read('../app/automations/page.tsx')
const AUTOMATIONS_ROUTE = read('../../../worker/src/routes/automations.ts')
const AREA_PROPERTIES = read('../components/rich-menus/area-properties.tsx')
const RICH_MENU_ROUTE = read('../../../worker/src/routes/rich-menu-groups.ts')

describe('#599 横断契約の一本化', () => {
  it('リッチメニューの利用側が共有の寸法・intent対応表を参照する', () => {
    expect(AREA_PROPERTIES).toContain('RICH_MENU_ACTION_TYPE_BY_INTENT[intent]')
    expect(RICH_MENU_ROUTE).toContain('RICH_MENU_ACTION_TYPE_BY_INTENT[intent]')
    expect(RICH_MENU_ROUTE).toContain('RICH_MENU_DIMENSIONS.large')
    expect(AREA_PROPERTIES).not.toContain('const ACTION_TYPE_BY_INTENT')
    expect(RICH_MENU_ROUTE).not.toContain('const ACTION_TYPE_BY_INTENT')
  })

  it('呼出しのない旧メディア口と再輸出ファイルを戻さない', () => {
    expect(API).not.toContain('upload: (data:')
    expect(API).not.toContain('usages: (id: string, accountId: string)')
    expect(CONTENTS_ROUTE).not.toContain("contents.post('/api/media',")
    expect(CONTENTS_ROUTE).not.toContain("contents.get('/api/media/:id/usages',")
    expect(existsSync(new URL('../app/contents/media-button.tsx', import.meta.url))).toBe(false)
  })

  it('WebとWorkerのオートメーション表示名が共有関数を使う', () => {
    expect(AUTOMATIONS_PAGE).toContain('automationTriggerLabel(item.eventType)')
    expect(AUTOMATIONS_PAGE).toContain('automationActionLabel(action.type)')
    expect(AUTOMATIONS_ROUTE).toContain('automationTriggerLabel(row.trigger_type)')
    expect(AUTOMATIONS_ROUTE).toContain('automationActionLabel(row.failed_action)')
    expect(AUTOMATIONS_PAGE).not.toContain('const eventTypeLabelMap')
    expect(AUTOMATIONS_ROUTE).not.toContain('const TRIGGER_LABELS')
  })
})
