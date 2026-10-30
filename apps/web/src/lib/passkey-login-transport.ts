import type { AuthenticationResponseJSON } from '@simplewebauthn/browser'

export function requestPasskeyLoginOptions(challengeToken: string): Promise<Response> {
  return fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/passkeys/login/options`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeToken }),
  })
}

export function verifyPasskeyLogin(input: { loginChallengeToken: string; challengeToken: string; response: AuthenticationResponseJSON }): Promise<Response> {
  return fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/passkeys/login/verify`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}
