// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { beginAdminLoginHandoff, adminSessionHandoffPath, captureAdminSessionHandoff, captureTwoFactorChallenge, clearAdminSession, getAdminSessionToken, storeAdminSession, twoFactorChallengeHandoffPath } from './admin-session'

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); clearAdminSession(); window.history.replaceState(null, '', '/login') })
describe('browser-originated authentication handoff', () => {
  it('F3: a fragment cannot replace the signed-in session on any admin page', () => {
    storeAdminSession('victim', 'victim-csrf')
    window.history.replaceState(null, '', '/hq#lh_session=attacker&lh_csrf=attacker')
    expect(captureAdminSessionHandoff()).toBe('victim')
    expect(getAdminSessionToken()).toBe('victim')
    expect(localStorage.getItem('lh_csrf')).toBe('victim-csrf')
    expect(window.location.hash).toBe('')
  })
  it('F10: an unsolicited 2FA challenge is not accepted', () => {
    window.history.replaceState(null, '', '/login/two-factor#lh_2fa=attacker')
    expect(captureTwoFactorChallenge()).toBe('')
    expect(sessionStorage.getItem('lh_two_factor_challenge')).toBeNull()
  })
  it('accepts one matching callback on its landing page and refuses replay', () => {
    const nonce = beginAdminLoginHandoff()
    const url = `/#lh_session=authorized&lh_csrf=csrf&lh_nonce=${nonce}`
    window.history.replaceState(null, '', url)
    expect(captureAdminSessionHandoff()).toBe('authorized')
    clearAdminSession()
    window.history.replaceState(null, '', url)
    expect(captureAdminSessionHandoff()).toBe('')
  })
  it('F3/F10: rejects wrong nonce, wrong landing and expired login attempts', () => {
    const nonce = beginAdminLoginHandoff()
    window.history.replaceState(null, '', `/hq#lh_session=attacker&lh_nonce=${nonce}`)
    expect(captureAdminSessionHandoff()).toBe('')
    const url = twoFactorChallengeHandoffPath('/login/two-factor', 'authorized')
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 601000)
    window.history.replaceState(null, '', url)
    expect(captureTwoFactorChallenge()).toBe('')
    vi.restoreAllMocks()
  })
  it('a trusted password/2FA response and a same-token navigation still work', () => {
    const challengeUrl = twoFactorChallengeHandoffPath('/login/two-factor', 'authorized')
    window.history.replaceState(null, '', challengeUrl)
    expect(captureTwoFactorChallenge()).toBe('authorized')
    storeAdminSession('authorized-session')
    const sessionUrl = adminSessionHandoffPath('/ops/two-factor', 'authorized-session', 'csrf')
    window.history.replaceState(null, '', sessionUrl)
    expect(captureAdminSessionHandoff()).toBe('authorized-session')
  })
})
