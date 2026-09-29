## 追加

- 他社向けLINE管理サービス用に musubo.jp のカスタムドメインを追加した。検証は `stg-admin.musubo.jp`（管理画面）と `stg-api.musubo.jp`（Worker API/LIFF）、本番は `admin.musubo.jp` と `api.musubo.jp`。既存の pages.dev / workers.dev URLはそのまま併用でき、ADMIN_ORIGIN には両方のオリジンを登録する。本番の ADMIN_ORIGIN と管理画面ビルドの NEXT_PUBLIC_API_URL は GitHub 側の変数・シークレット更新が別途必要 @masato 2026-09-29
