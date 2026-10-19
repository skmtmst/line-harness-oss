import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock('@/contexts/account-context', () => ({ useAccount: () => ({ selectedAccountId: null, selectedAccount: null }) }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('@/v8/booking-menus/lib/edit-permission', () => ({ useBookingEdit: () => false }))
import { readUiSource } from '../../scripts/test-ui-source.mjs'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const APP = join(SRC, 'app')

const MAINB_V8_SCREENS = [
  ['/mileage', '@/v8/mileage/mileage', 'v8/mileage/mileage.tsx', '<MileageShell.Provider'],
  ['/conversions', '@/v8/conversions/list', 'v8/conversions/list.tsx', '<ListPage'],
  ['/conversions/new', '@/v8/conversions/create', 'v8/conversions/create.tsx', '<CreatePage'],
  ['/webhooks', '@/v8/webhooks/outgoing', 'v8/webhooks/outgoing.tsx', '<ListPage'],
  ['/webhooks/new', '@/v8/webhooks/create', 'v8/webhooks/create.tsx', '<CreatePage'],
  ['/contents', '@/v8/contents/list', 'v8/contents/list.tsx', '<ListPage'],
  ['/contents/vars', '@/v8/common-vars/list', 'v8/common-vars/list.tsx', '<ListPage'],
  ['/pools/new', '@/v8/settings/pools/create', 'v8/settings/pools/create.tsx', '<SbSettingsScreen'],
  ['/form-submissions/edit', '@/v8/form-edit/edit', 'v8/form-edit/edit.tsx', '<CreatePage'],
  ['/booking/staff/shifts', '@/v8/booking-staff/shifts', 'v8/booking-staff/shifts.tsx', '<PageHeading'],
  ['/booking/menus', '@/v8/booking-menus/settings', 'v8/booking-menus/settings.tsx', '<PageHeading'],
  ['/booking/menus/new', '@/v8/booking-menus/menu-form', 'v8/booking-menus/menu-form.tsx', '<PageHeading'],
  ['/booking/staff/new', '@/v8/booking-staff/staff-new', 'v8/booking-staff/staff-new.tsx', '<CreatePage'],
  ['/booking/menus/staff', '@/v8/booking-menus/assign', 'v8/booking-menus/assign.tsx', '<PageHeading'],
  ['/contents/vars/new', '@/v8/common-vars-edit/new', 'v8/common-vars-edit/new.tsx', '<CreatePage'],
  ['/broadcasts', '@/v8/broadcasts/list', 'v8/broadcasts/list.tsx', '<ListPage'],
  ['/broadcasts/detail', '@/v8/broadcast-detail/detail', 'v8/broadcast-detail/detail.tsx', '<PageFrame'],
  ['/scenarios/detail', '@/v8/scenario-detail/detail', 'v8/scenario-detail/detail.tsx', '<PageFrame'],
  ['/reminders/new', '@/v8/reminders/new/new', 'v8/reminders/new/new.tsx', '<CreatePage'],
  ['/auto-replies', '@/v8/auto-replies/list', 'v8/auto-replies/list.tsx', '<ListPage'],
  ['/auto-replies/edit', '@/v8/auto-replies/edit/wizard', 'v8/auto-replies/edit/wizard.tsx', '<CreatePage'],
  ['/friend-add-settings', '@/v8/friend-add/list', 'v8/friend-add/list.tsx', '<ListPage'],
  ['/scenarios/mode', '@/v8/scenarios/create', 'v8/scenarios/create.tsx', '<CreatePage'],
  ['/scenarios/first-step', '@/v8/scenario-first-step/first-step', 'v8/scenario-first-step/first-step.tsx', '<CreatePage'],
  ['/events', '@/v8/events/list', 'v8/events/list.tsx', '<ListPage'],
  ['/events/bookings', '@/v8/events/bookings', 'v8/events/bookings.tsx', '<DetailPage'],
  ['/events/edit', '@/v8/events/edit', 'v8/events/edit.tsx', '<DetailPage'],
  ['/webinars/new', '@/v8/webinar-edit/new', 'v8/webinar-edit/new.tsx', '<CreatePage'],
  ['/webinars/edit', '@/v8/webinar-edit/edit', 'v8/webinar-edit/edit.tsx', '<CreatePage'],
  ['/emergency', '@/v8/settings/emergency/screen', 'v8/settings/emergency/screen.tsx', '<SbSettingsScreen'],
  ['/automations', '@/v8/automations/list', 'v8/automations/list.tsx', '<ListPage'],
  ['/automations/new', '@/v8/automations/create/create', 'v8/automations/create/create.tsx', '<CreatePage'],
  ['/nen-campaigns', '@/v8/nen-campaigns/list', 'v8/nen-campaigns/list.tsx', '<ListPage'],
  ['/staff', '@/v8/settings/staff/staff', 'v8/settings/staff/staff.tsx', '<PageFrame'],
] as const;
const CURRENT_ROUTES = ["/ops/knowledge", "/hq/billing", "/hq/open", "/hq/members", "/", "/chats", "/friends", "/tags", "/templates", "/scenarios", "/reminders", "/booking/bookings", "/booking/bookings/detail", "/booking/staff", "/inflow-links", "/inflow-links/new", "/inflow-links/detail", "/broadcasts/new", "/templates/detail", "/templates/edit", "/templates/carousel", "/rich-menus", "/rich-menus/edit", "/rich-menus/new", "/webinars", "/staff/new", "/settings", "/tags/new", "/tags/fields/new", "/tags/fields/migrate", "/nen-members", "/ec-commerce", "/login", "/friends/detail", "/accounts/new", "/register", "/register/sent", "/register/complete", "/password/forgot", "/password/reset"] as const
function entryFile(route: string) { return join(APP, route, 'page.tsx') }
function readWithParts(route: string) { return readUiSource(entryFile(route), 'utf8') }
function entryBody(route: string) {
  const file = entryFile(route)
  const source = readFileSync(file, 'utf8')
  const forwarded = source.match(/export \{ default \} from ['"](@\/v8\/[^'"]+)['"]/)?.[1]
  return forwarded ? readFileSync(join(SRC, `${forwarded.slice(2)}.tsx`), 'utf8') : source
}
function renderedImports(source: string) {
  const parsed = ts.createSourceFile('current.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const imports = new Set<string>()
  const rendered = new Set<string>()
  function walk(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause
      if (clause?.name) imports.add(clause.name.text)
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const spec of clause.namedBindings.elements) if (!spec.isTypeOnly) imports.add(spec.name.text)
      }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) rendered.add(node.tagName.getText(parsed))
    ts.forEachChild(node, walk)
  }
  walk(parsed)
  return [...rendered].filter((name) => imports.has(name) && name !== 'Suspense')
}

describe('current page entries and V8 components', () => {
  it('current routes are registered', () => {
    expect(CURRENT_ROUTES.length).toBeGreaterThan(0)
    expect(new Set(CURRENT_ROUTES).size).toBe(CURRENT_ROUTES.length)
  })
  it.each(MAINB_V8_SCREENS)('%s の入口はV8本体を描く', (route, module, file, template) => {
    const entry = readFileSync(join(APP, route, 'page.tsx'), 'utf8');
    if (entry.includes(`export { default } from '${module}'`)) {
      expect(entry).not.toContain('useAdminTheme');
      return;
    }
    const imported = [...entry.matchAll(/import\s+(?:\{\s*(\w+)(?:\s+as\s+(\w+))?[^}]*\}|(\w+))\s+from ['"]([^'"]+)['"]/g)]
      .find((match) => match[4] === module);
    expect(imported, `${route} が ${module} を読む`).toBeDefined();
    expect(entry).toContain(`<${imported![2] ?? imported![1] ?? imported![3]}`);
  });

  it.each(MAINB_V8_SCREENS)('%s のV8本体は共通の型を使う', async (route, _module, file, template) => {
    if (route === '/booking/menus' || route === '/booking/menus/new' || route === '/booking/menus/staff') {
      // : the old heading's source spelling cannot prove the page frame exists.
      const screenModule = route === '/booking/menus' ? await import('@/v8/booking-menus/settings')
        : route === '/booking/menus/new' ? await import('@/v8/booking-menus/menu-form')
          : await import('@/v8/booking-menus/assign')
      const html = renderToStaticMarkup(createElement(screenModule.default as import('react').ComponentType<{ accountId: null }>, { accountId: null }))
      expect(html).toContain('data-page-template="create"')
      expect(html).toContain('data-template-region="content"')
      return
    }
    const body = readUiSource(join(SRC, file), 'utf8');
    expect(body).toContain(template);
  });

  it.each([
    ['/broadcasts/new', '<BroadcastForm'],
    // 2026-10-06：一覧は src/v8/forms/list に一から書いた。板の印は型（ListPage）の boardId で付ける。
    ['/form-submissions', "boardId={narrow ? 'GrnO4' : 'I3L41O'}"],
  ])('%s はV8の画面を読み込む', (route, marker) => {
    expect(readWithParts(route)).toContain(marker);
  });


  it.each(CURRENT_ROUTES)('%s has a current entry without a theme chooser', (route) => {
    const source = readFileSync(entryFile(route), 'utf8')
    expect(source).toMatch(/export default|export \{ default \}/)
    expect(source).not.toContain('useAdminTheme')
    expect(source).not.toMatch(/NEXT_PUBLIC_ADMIN_THEME|lh-admin-theme|v7:/)
  })
  it.each(CURRENT_ROUTES)('%s connects its rendered component', (route) => {
    expect(renderedImports(entryBody(route)).length).toBeGreaterThan(0)
    expect(readWithParts(route)).not.toMatch(/from ['"][^'"]*-v7['"]|VariantContext/)
  })
})
