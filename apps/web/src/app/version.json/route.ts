// 静的書き出しにも含める公開口。ログイン・API・秘密値に依存しない。
export const dynamic = 'force-static'

export function GET() {
  return Response.json({
    git_commit: process.env.APP_COMMIT_SHA_FULL ?? 'unknown',
    version: process.env.APP_VERSION ?? '0.0.0-dev',
    released_at: process.env.APP_BUILD_TIME ?? null,
  })
}
