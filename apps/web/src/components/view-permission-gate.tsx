'use client'

import { Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { HQ_MENU_SECTIONS, MENU_SECTIONS, isHqShellPath, menuOwnerForScreen, type MenuItem } from '@/lib/menu'
import { canManageRole, loadStaffIdentity, useStaffRole } from '@/lib/staff-role'
import { readStaffIdentity } from '@/lib/staff-identity-state'
import { canEditFeature, canViewFeature } from '@/lib/staff-capability'
import { readPermissionSessionSnapshot as readSessionSnapshot, SESSION_SNAPSHOT_CHANGED } from '@/lib/session-snapshot'
import TargetMissing from '@/components/shared/target-missing'
import ListState from '@/components/shared/list-state'
import { LockedCreatePage } from '@/components/templates'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'

const MENU_ITEMS = [...MENU_SECTIONS, ...HQ_MENU_SECTIONS].flatMap(section => section.items)
const subscribeSession = (listener: () => void) => {
  window.addEventListener(SESSION_SNAPSHOT_CHANGED, listener)
  return () => window.removeEventListener(SESSION_SNAPSHOT_CHANGED, listener)
}
const serverSession = () => null

/** 別名のURLとその下の画面も、左メニューの所属の表で判定する。 */
function menuItemsForPath(pathname: string, search = ''): MenuItem[] {
  let path = pathname
  while (path !== '/') {
    const owners = menuOwnerForScreen(path, path === pathname ? search : '')
    const declared = owners?.flatMap(id => MENU_ITEMS.filter(item => item.id === id))
    if (declared?.length) return declared
    path = path.slice(0, path.lastIndexOf('/')) || '/'
  }
  let found: MenuItem | null = null
  for (const item of MENU_ITEMS) {
    const hit = item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`)
    if (hit && (!found || item.href.length > found.href.length)) found = item
  }
  return found ? [found] : []
}

export function menuItemForPath(pathname: string, search = ''): MenuItem | null {
  return menuItemsForPath(pathname, search)[0] ?? null
}

function CheckingPermission({ failed = false, onRetry }: { failed?: boolean; onRetry?: () => void }) {
  return <PageFrame kind="detail"><PageHeading title="権限を確認しています" /><ListState kind={failed ? 'error' : 'loading'} onRetry={onRetry} /></PageFrame>
}

function ResolvedViewPermissionGate({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/'
  const search = useSearchParams()?.toString() ?? ''
  const role = useStaffRole()
  const session = useSyncExternalStore(subscribeSession, readSessionSnapshot, serverSession)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // useStaffRole と同じ本人APIの読み込みを共有し、失敗を許可に変えず読み直せるようにする。
  useEffect(() => {
    if (role !== null) { setFailed(false); return }
    let active = true
    setFailed(false)
    void loadStaffIdentity().then(result => {
      if (active && !result.success) setFailed(true)
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [role, attempt])
  // 本人の権限が分かるまで子をマウントせず、自動下書きや読込を始めさせない。
  if (role === null) return <CheckingPermission failed={failed} onRetry={() => setAttempt(value => value + 1)} />

  const items = menuItemsForPath(pathname, search)
  const signedInRole = readStaffIdentity()?.role ?? role
  const canRead = (item: MenuItem) => {
    if (item.href === '/staff' && !canManageRole(signedInRole)) return false
    if (item.href === '/accounts' && signedInRole === 'staff') return false
    if (item.staffOnly && signedInRole !== 'staff') return false
    const key = item.permissionKey ?? item.href
    return item.required || canEditFeature(key, role) || canViewFeature(key, role)
  }
  const restricted = role === 'staff' || role === 'viewer'
  const allowed = restricted ? items.find(canRead) : items[0]
  const item = allowed ?? items[0]
  if (restricted && item && !allowed) return <PageFrame kind="detail">
    <PageHeading title={item.label} />
    <TargetMissing kind="forbidden" title="この画面を見る権限がありません" description="見たい時はオーナーか管理者に頼んでください。" backHref="/" backLabel="ダッシュボードへ" />
  </PageFrame>

  const creating = /\/(?:new|create)(?:\/|$)/.test(pathname)
  const params = new URLSearchParams(search)
  const startsDraft = pathname === '/automations/drafts' && Boolean(params.get('automationId')) && !params.get('id')
  const writingEntry = creating || startsDraft
  const backHref = item?.href ?? (pathname.replace(/\/(?:new|create)(?:\/.*)?$/, '') || '/')
  const title = item ? `${item.label}の${creating ? '作成' : '編集'}` : '新しく作る'
  const backLabel = item ? `${item.label}の一覧へ` : '一覧へ'
  if (writingEntry && session?.impersonation?.mode === 'read') return <PageFrame kind="create">
    <PageHeading title={title} />
    <TargetMissing kind="forbidden" title={`代理ログイン（閲覧）中のため、ここでは${creating ? '作れません' : '変えられません'}`} description="書き込みに切り替えてから操作してください。" backHref={backHref} backLabel={backLabel} />
  </PageFrame>
  if (writingEntry && role === 'staff' && item && !canEditFeature(item.permissionKey ?? item.href, role)) return <PageFrame kind="create">
    <PageHeading title={title} />
    <TargetMissing kind="forbidden" title="この画面を変える権限がありません" description="作りたい時はオーナーか管理者に頼んでください。" backHref={backHref} backLabel={backLabel} />
  </PageFrame>
  if (role === 'viewer' && writingEntry) return <LockedCreatePage title={title} mode={creating ? 'create' : 'edit'}
    scope={isHqShellPath(pathname) ? 'hq' : 'store'} backHref={backHref} backLabel={backLabel} />
  return <>{children}</>
}

/** 閲覧権限と作成権限を、画面の処理を始める前に確認する。 */
export default function ViewPermissionGate({ children }: { children: ReactNode }) {
  return <Suspense fallback={<CheckingPermission />}><ResolvedViewPermissionGate>{children}</ResolvedViewPermissionGate></Suspense>
}
