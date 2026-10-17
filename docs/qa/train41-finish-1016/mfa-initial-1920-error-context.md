# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: train30-auth.spec.mjs >> policy confirmation and personal recovery counts at 1920
- Location: apps/web/src/v8/login/train30-auth.spec.mjs:80:39

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByRole('dialog', { name: '二段階認証の必須をオフにしますか' }).getByRole('button', { name: 'オフにする', exact: true })

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - link "本文へ移動" [ref=e3] [cursor=pointer]:
      - /url: "#main-content"
    - generic [ref=e4]:
      - complementary [ref=e5]:
        - generic [ref=e6]:
          - generic [ref=e7]: 然
          - generic [ref=e8]:
            - generic "株式会社 然" [ref=e9]
            - generic [ref=e10]: musubo
        - navigation [ref=e11]:
          - generic [ref=e12]:
            - button "メイン" [expanded] [ref=e13] [cursor=pointer]
            - generic [ref=e18]:
              - link "ダッシュボード" [ref=e19] [cursor=pointer]:
                - /url: /
              - link "受信箱" [ref=e25] [cursor=pointer]:
                - /url: /chats
              - link "友だち" [ref=e31] [cursor=pointer]:
                - /url: /friends
              - link "タグ" [ref=e39] [cursor=pointer]:
                - /url: /tags
        - link "設定" [ref=e46] [cursor=pointer]:
          - /url: /settings
        - paragraph [ref=e52]: 版の情報なし
        - button "自分のメニュー（Kenta Kawano・オーナー）" [ref=e54] [cursor=pointer]:
          - generic [ref=e55]: K
          - generic [ref=e56]:
            - generic [ref=e57]: Kenta Kawano
            - generic [ref=e58]: オーナー
      - generic [ref=e62]:
        - banner [ref=e64]:
          - generic [ref=e65]:
            - button "メニューを畳む・広げる" [ref=e66] [cursor=pointer]
            - navigation "パンくず" [ref=e70]:
              - link "ホーム" [ref=e71] [cursor=pointer]:
                - /url: /
              - link "設定" [ref=e82] [cursor=pointer]:
                - /url: /settings
              - heading "ログインユーザー" [level=1] [ref=e86]
          - generic [ref=e87]:
            - generic [ref=e89]:
              - generic [ref=e91]:
                - generic [ref=e92]: LINEアカウント
                - generic [ref=e93]: 店舗を選択
              - button "アカウントを切り替える" [ref=e97] [cursor=pointer]
            - button "通知" [ref=e98] [cursor=pointer]
        - main [ref=e102]:
          - generic [ref=e106]:
            - generic [ref=e108]:
              - generic [ref=e109]:
                - heading "ログインユーザー" [level=2] [ref=e110]
                - button "ログインユーザーの説明" [ref=e112] [cursor=pointer]:
                  - generic [ref=e113]: "?"
              - navigation [ref=e116]:
                - tablist "ログインユーザーの切り替え" [ref=e117]:
                  - tab "いまいる人" [selected] [ref=e119]
                  - tab "招待中" [ref=e120] [cursor=pointer]
                  - tab "入った記録" [ref=e121] [cursor=pointer]
                  - tab "権限のかたまり" [ref=e122] [cursor=pointer]
            - generic [ref=e123]:
              - navigation "設定の中のメニュー" [ref=e124]:
                - paragraph [ref=e125]: 設定
                - list [ref=e126]:
                  - listitem [ref=e127]:
                    - link "お客さまのデザイン" [ref=e128] [cursor=pointer]:
                      - /url: /settings/customer-look
                  - listitem [ref=e135]:
                    - link "はじめの設定" [ref=e136] [cursor=pointer]:
                      - /url: /getting-started
                  - listitem [ref=e142]:
                    - link "LINEアカウント" [ref=e143] [cursor=pointer]:
                      - /url: /accounts
                  - listitem [ref=e146]:
                    - link "ログインユーザー" [ref=e147] [cursor=pointer]:
                      - /url: /staff
                  - listitem [ref=e153]:
                    - link "機能設定" [ref=e154] [cursor=pointer]:
                      - /url: /settings
                  - listitem [ref=e156]:
                    - link "運用状態" [ref=e157] [cursor=pointer]:
                      - /url: /emergency
                  - listitem [ref=e160]:
                    - link "SNS 連携" [ref=e161] [cursor=pointer]:
                      - /url: /settings/sns
              - generic [ref=e168]:
                - region [ref=e169]:
                  - generic [ref=e171]:
                    - heading "ログインの安全" [level=2] [ref=e172]
                    - generic [ref=e173]: 管理画面へ入る時の確かめ方を決めます
                  - generic [ref=e174]:
                    - generic [ref=e175]:
                      - heading "ログインで二段階認証を必須にする" [level=3] [ref=e176]
                      - paragraph [ref=e177]: 全員が、ログインのたびに認証アプリの6桁を入れます。まだ登録していない人は、次のログインで登録します。
                    - switch "ログインで二段階認証を必須にする" [checked] [disabled] [ref=e179] [cursor=pointer]
                  - generic [ref=e181]:
                    - generic [ref=e182]:
                      - heading "登録済み" [level=3] [ref=e183]
                      - strong [ref=e184]: 4 / 6 人
                    - button "未登録の人を見る →" [ref=e185] [cursor=pointer]
                  - paragraph [ref=e186]: 切り替えられるのはオーナー（運営）だけです。切り替えは記録に残ります。
                - note [ref=e187]:
                  - generic [ref=e190]: 回復コードの残りが2個です。認証アプリが使えない時に入れなくなる前に、作り直してください。
                - region [ref=e191]:
                  - generic [ref=e193]:
                    - heading "自分の二段階認証" [level=2] [ref=e194]
                    - generic [ref=e195]: このアカウントでログインする時の確かめ
                  - generic [ref=e196]:
                    - generic [ref=e197]:
                      - heading "認証アプリ" [level=3] [ref=e198]
                      - strong [ref=e199]: 登録済み（10月12日（月））
                    - button "登録し直す" [ref=e200] [cursor=pointer]
                  - generic [ref=e201]:
                    - generic [ref=e202]:
                      - heading "回復コード" [level=3] [ref=e203]
                      - strong [ref=e204]: 残り 2 / 8 個
                    - button "回復コードを作り直す" [ref=e205] [cursor=pointer]
                  - paragraph [ref=e206]: 作り直すと、前のコードは全部使えなくなります。新しい8個は、作った時に1回だけ表示します。
                - generic [ref=e207]:
                  - searchbox "名前・メールで探す" [ref=e212]
                  - group "利用状態で絞り込む" [ref=e213]:
                    - button "有効 5" [pressed] [ref=e214] [cursor=pointer]
                    - button "止めた 1" [ref=e215] [cursor=pointer]
                  - link "人を招待する" [ref=e216] [cursor=pointer]:
                    - /url: /staff/new
                - region "いまいる人" [ref=e220]:
                  - generic [ref=e222]:
                    - heading "いまいる人" [level=2] [ref=e223]
                    - generic [ref=e224]:
                      - generic [ref=e225]: 5人
                      - generic [ref=e226]: 二段階認証が未設定の人が 2人 います。高い権限の人から設定してください。
                  - table "いまいる人の一覧" [ref=e227]:
                    - row "人 役割 最後に入った 操作" [ref=e228]:
                      - columnheader "人" [ref=e229]
                      - columnheader "役割" [ref=e230]
                      - columnheader "最後に入った" [ref=e231]
                      - columnheader "操作"
                    - row [ref=e233]:
                      - cell "Kenta Kawanoの中身を見る kenta@***.jp" [ref=e234]:
                        - generic [ref=e235]: K
                        - generic [ref=e236]:
                          - button "Kenta Kawanoの中身を見る" [ref=e237] [cursor=pointer]: Kenta Kawano
                          - generic "kenta@***.jp" [ref=e238]
                      - cell "オーナー" [ref=e239]:
                        - generic "オーナー" [ref=e241]
                      - cell "いま" [ref=e242]
                      - cell [ref=e243]:
                        - button "Kenta Kawanoの操作" [ref=e244] [cursor=pointer]
                    - row [ref=e249]:
                      - cell "Masatoの中身を見る masato@***.jp" [ref=e250]:
                        - generic [ref=e251]: M
                        - generic [ref=e252]:
                          - button "Masatoの中身を見る" [ref=e253] [cursor=pointer]: Masato
                          - generic "masato@***.jp" [ref=e254]
                      - cell "管理者" [ref=e255]:
                        - generic "管理者" [ref=e257]
                      - cell "09/30" [ref=e258]
                      - cell [ref=e259]:
                        - button "Masatoの操作" [ref=e260] [cursor=pointer]
                    - row [ref=e265]:
                      - cell "佐々木 亮太の中身を見る sasaki@***.jp" [ref=e266]:
                        - generic [ref=e267]: 佐
                        - generic [ref=e268]:
                          - button "佐々木 亮太の中身を見る" [ref=e269] [cursor=pointer]: 佐々木 亮太
                          - generic "sasaki@***.jp" [ref=e270]
                      - cell "運用" [ref=e271]:
                        - generic "運用" [ref=e273]
                      - cell "09/30" [ref=e274]
                      - cell [ref=e275]:
                        - button "佐々木 亮太の操作" [ref=e276] [cursor=pointer]
                    - row [ref=e281]:
                      - cell "中川 由美の中身を見る nakagawa@***.jp" [ref=e282]:
                        - generic [ref=e283]: 中
                        - generic [ref=e284]:
                          - button "中川 由美の中身を見る" [ref=e285] [cursor=pointer]: 中川 由美
                          - generic "nakagawa@***.jp" [ref=e286]
                      - cell "受付" [ref=e287]:
                        - generic "受付" [ref=e289]
                      - cell "09/29" [ref=e290]
                      - cell [ref=e291]:
                        - button "中川 由美の操作" [ref=e292] [cursor=pointer]
                    - row [ref=e297]:
                      - cell "外部の税理士の中身を見る tax@***.jp" [ref=e298]:
                        - generic [ref=e299]: 外
                        - generic [ref=e300]:
                          - button "外部の税理士の中身を見る" [ref=e301] [cursor=pointer]: 外部の税理士
                          - generic "tax@***.jp" [ref=e302]
                      - cell "見るだけ" [ref=e303]:
                        - generic "見るだけ" [ref=e305]
                      - cell "09/01" [ref=e306]
                      - cell [ref=e307]:
                        - button "外部の税理士の操作" [ref=e308] [cursor=pointer]
                - generic [ref=e313]:
                  - paragraph [ref=e314]: ログインユーザー 5 人中 5 人を表示
                  - navigation "ページ送り" [ref=e315]:
                    - button "前のページ" [disabled] [ref=e316]:
                      - generic [ref=e317]: ‹
                    - button "1ページ目へ" [ref=e318] [cursor=pointer]: "1"
                    - button "次のページ" [disabled] [ref=e319]:
                      - generic [ref=e320]: ›
                - group [ref=e321]:
                  - generic "ログイン中の端末を確認" [ref=e322] [cursor=pointer]
              - complementary "補足" [ref=e323]:
                - region "直したあとの列" [ref=e324]:
                  - heading "直したあとの列" [level=2] [ref=e325]
                  - paragraph [ref=e326]: 表に足す列：職位・見せる範囲・2段階の確認・最後の操作（下は1人分の中身の例）
                  - generic [ref=e327]:
                    - paragraph [ref=e328]:
                      - generic "Kenta Kawano" [ref=e330]
                      - generic "2段階 オン" [ref=e332]
                    - paragraph [ref=e333]: オーナー・代表
                    - paragraph [ref=e334]: 見せる範囲：すべて
                    - paragraph [ref=e335]: 最後に入った：いま（最後の操作 10月16日（金）17:52）
                  - generic [ref=e336]:
                    - paragraph [ref=e337]:
                      - generic "中川 由美" [ref=e339]
                      - generic "確認が必要" [ref=e341]
                    - paragraph [ref=e342]: 受付・店長
                    - paragraph [ref=e343]: 見せる範囲：6機能／然-NEN-TEST
                    - paragraph [ref=e344]: 最後に入った：09/29（最後の操作 9月29日（火）18:02）
                  - generic [ref=e345]:
                    - paragraph [ref=e346]:
                      - generic "外部の税理士" [ref=e348]
                      - generic "停止中" [ref=e350]
                    - paragraph [ref=e351]: 見るだけ・請求の確認
                    - paragraph [ref=e352]: 見せる範囲：1機能／然-NEN-TEST
                    - paragraph [ref=e353]: 最後に入った：09/01
                - region "役割でできること" [ref=e354]:
                  - heading "役割でできること" [level=2] [ref=e355]
                  - list [ref=e356]:
                    - listitem [ref=e357]:
                      - generic "オーナー" [ref=e360]
                      - generic [ref=e361]: すべて。お金・会社とロゴ・ほかの人の役割も変えられる
                    - listitem [ref=e362]:
                      - generic "管理者" [ref=e365]
                      - generic [ref=e366]: すべての機能を作る・変える・送る。ログインユーザーの招待と役割
                    - listitem [ref=e367]:
                      - generic "運用" [ref=e370]
                      - generic [ref=e371]: 配信・受信箱・友だち・予約を作る・送る。設定は見るだけ
                    - listitem [ref=e372]:
                      - generic "受付" [ref=e375]
                      - generic [ref=e376]: 受信箱の返信と予約の受付だけ
                    - listitem [ref=e377]:
                      - generic "見るだけ" [ref=e380]
                      - generic [ref=e381]: 画面を見られる（操作は出ません）
                  - paragraph [ref=e382]: 「個別設定」にすると、画面ごと・アカウントごとに細かく決められます。
  - status "知らせ"
  - alert [ref=e383]
  - dialog [ref=e384]:
    - generic [ref=e385]:
      - generic [ref=e386]:
        - heading "二段階認証の必須をオフにしますか" [level=2] [ref=e387]
        - paragraph [ref=e388]: オフにすると、パスワードやLINEだけで入れるようになります
      - button "閉じる" [ref=e389] [cursor=pointer]
    - generic [ref=e393]:
      - paragraph [ref=e394]: 続けるには、あなたの認証アプリの6桁を入れてください。
      - paragraph [ref=e395]: 認証コード（6桁）
      - generic [ref=e397]:
        - group "認証コード（6桁）" [ref=e398]:
          - textbox "1桁目" [active] [ref=e399]
          - textbox "2桁目" [ref=e400]
          - textbox "3桁目" [ref=e401]
          - textbox "4桁目" [ref=e402]
          - textbox "5桁目" [ref=e403]
          - textbox "6桁目" [ref=e404]
        - status [ref=e405]
      - paragraph [ref=e406]: 自分で登録した人には、オフのあいだも確かめが出ます。オンに戻すのは、いつでもできます。
```

# Test source

```ts
  10  |   })
  11  |   expect(position.align).toBe('center'); expect(position.delta).toBeLessThanOrEqual(1)
  12  | }
  13  | async function detailTypography(page, label) {
  14  |   const heading = page.getByRole('heading', { name: label, exact: true })
  15  |   const value = heading.locator('..').locator('strong')
  16  |   const typography = el => { const style = getComputedStyle(el); return { size: parseFloat(style.fontSize), weight: Number(style.fontWeight) } }
  17  |   const headingStyle = await heading.evaluate(typography)
  18  |   const valueStyle = await value.evaluate(typography)
  19  |   expect(headingStyle.size).toBeLessThanOrEqual(12)
  20  |   expect(valueStyle).toEqual({ size: 13, weight: 600 })
  21  |   expect(headingStyle.weight).toBeLessThan(valueStyle.weight)
  22  | }
  23  | for (const width of [1152,1440,1920]) test(`MFA input, one-time display and centered auth buttons at ${width}`, async ({ page }) => {
  24  |   await page.setViewportSize({ width, height: 1000 })
  25  |   const errors = []; page.on('pageerror', error => errors.push(error.message))
  26  |   let submitted = null
  27  |   await page.route('**/api/**', async route => {
  28  |     const url = new URL(route.request().url()); const path = url.pathname
  29  |     let data
  30  |     if (path === '/api/auth/password/reset/check') data = { email: 'fixture@example.com' }
  31  |     if (path === '/api/auth/two-factor/setup') data = { provisioningUri: 'otpauth://totp/musubo:fixture?secret=JBSWY3DPEHPK3PXP&issuer=musubo', manualKey: 'JBSW Y3DP EHPK 3PXP' }
  32  |     if (path === '/api/auth/two-factor/setup/confirm') data = { recoveryCodes: codes }
  33  |     if (path === '/api/auth/two-factor/verify') { submitted = route.request().postDataJSON(); return route.fulfill({ status: 400, json: { success: false, error: 'コードが違います' } }) }
  34  |     if (data) return route.fulfill({ status: 200, json: { success: true, data } })
  35  |     // Every remaining API request is redirected to the local fixture server.
  36  |     return route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:${mockPort}${url.pathname}${url.search}` }) })
  37  |   })
  38  |   await page.goto('/login'); await centered(page.getByRole('button', { name: 'ログイン', exact: true }))
  39  |   const brandStyle = await page.locator('[aria-hidden="true"]').filter({ hasText: 'm' }).first().evaluate(el => { const style = getComputedStyle(el); return { background: style.backgroundColor, color: style.color } })
  40  |   await page.goto('/password/reset?token=fixture-reset')
  41  |   await centered(page.getByRole('button', { name: 'パスワードを設定してログインへ' }))
  42  |   await page.goto('/login/two-factor#lh_2fa=fixture-challenge&lh_method=password')
  43  |   await expect(page.getByRole('textbox')).toHaveCount(6)
  44  |   expect(await page.getByRole('group', { name: '認証コード（6桁）' }).evaluate(el => getComputedStyle(el.closest('[data-field-content-gap]')).gap)).toBe('12px')
  45  |   await centered(page.getByRole('button', { name: '確認してログイン', exact: true }))
  46  |   await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`verify-${width}.png`) })
  47  |   await page.getByRole('button', { name: '回復コードを使う' }).click()
  48  |   await expect(page.getByRole('textbox')).toHaveCount(8)
  49  |   const hint = page.getByText('控えた8個のうち、まだ使っていない1つを入れます。貼り付けもできます。', { exact: true })
  50  |   expect(await hint.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(12)
  51  |   const back = page.getByRole('link', { name: 'ログインに戻る', exact: true })
  52  |   const method = page.getByRole('button', { name: '6桁のコードで入る', exact: true })
  53  |   const textStyle = el => { const style = getComputedStyle(el); return { size: style.fontSize, weight: style.fontWeight, color: style.color, background: style.backgroundColor } }
  54  |   expect(await back.evaluate(textStyle)).toEqual(await method.evaluate(textStyle))
  55  |   const mark = page.locator('[data-auth-layout="admin"] > div:first-child > span[aria-hidden="true"]')
  56  |   expect(await mark.evaluate(el => { const style = getComputedStyle(el); return { background: style.backgroundColor, color: style.color } })).toEqual(brandStyle)
  57  |   expect(await page.getByRole('group', { name: '回復コード（8文字）' }).evaluate(el => getComputedStyle(el.closest('[data-field-content-gap]')).gap)).toBe('12px')
  58  |   await page.getByRole('textbox', { name: '1文字目' }).evaluate(el => {
  59  |     const event = new Event('paste', { bubbles: true }); Object.defineProperty(event, 'clipboardData', { value: { getData: () => '7k2q-9fxm' } }); el.dispatchEvent(event)
  60  |   })
  61  |   await expect(page.getByRole('textbox', { name: '8文字目' })).toHaveValue('M')
  62  |   await centered(page.getByRole('button', { name: '確認してログイン', exact: true }))
  63  |   await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`recovery-input-${width}.png`) })
  64  |   await page.getByRole('button', { name: '確認してログイン', exact: true }).click()
  65  |   await expect.poll(() => submitted?.code).toBe('7K2Q-9FXM')
  66  |   await page.goto('/login/two-factor/setup#lh_2fa=fixture-setup')
  67  |   await expect(page.getByAltText('認証アプリ登録用のQRコード')).toBeVisible()
  68  |   await centered(page.getByRole('button', { name: '登録してログイン' }))
  69  |   await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`setup-${width}.png`) })
  70  |   await page.getByRole('textbox', { name: '1桁目' }).fill('123456')
  71  |   await expect(page.getByRole('list', { name: '8個の回復コード' }).getByRole('listitem')).toHaveCount(8)
  72  |   expect(await page.getByRole('button', { name: '回復コードをコピー' }).evaluate(textStyle)).toEqual(await page.getByRole('button', { name: 'ファイルに保存する' }).evaluate(textStyle))
  73  |   await centered(page.getByRole('button', { name: '控えました。ログインする' }))
  74  |   const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'ファイルに保存する' }).click(); expect((await download).suggestedFilename()).toBe('musubo-recovery-codes.txt')
  75  |   expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
  76  |   expect(await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => value.includes('7K2Q-9FXM')))).toBe(false)
  77  |   await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`recovery-${width}.png`) })
  78  |   expect(errors).toEqual([])
  79  | })
  80  | for (const width of [1152,1440,1920]) test(`policy confirmation and personal recovery counts at ${width}`, async ({ page }) => {
  81  |   await page.setViewportSize({ width, height: 1000 })
  82  |   let required = true, remaining = 2, writes = 0
  83  |   await page.route('**/api/**', async route => {
  84  |     const url = new URL(route.request().url()), path = url.pathname, method = route.request().method()
  85  |     let data
  86  |     if (path === '/api/auth/two-factor/policy') {
  87  |       if (method === 'PUT') { required = route.request().postDataJSON().required; writes++ }
  88  |       data = { required, canEdit: true, configured: true, notice: null, registered: 4, total: 6, relogin: false }
  89  |     }
  90  |     if (path === '/api/auth/two-factor/self') data = { staffId: 'visual-qa-owner', enabledAt: '2026-10-12T03:00:00Z', remaining, total: 8, canEdit: true, configured: true, notice: null }
  91  |     if (path === '/api/auth/step-up') data = { token: 'fixture-step-up-grant' }
  92  |     if (path === '/api/auth/two-factor/recovery') { remaining = 8; data = { recoveryCodes: codes } }
  93  |     if (data) return route.fulfill({ status: 200, json: { success: true, data } })
  94  |     return route.fulfill({ response: await route.fetch({ url: `http://127.0.0.1:${mockPort}${url.pathname}${url.search}` }) })
  95  |   })
  96  |   await page.goto('/staff')
  97  |   await expect(page.getByRole('heading', { name: '自分の二段階認証' })).toBeVisible()
  98  |   await detailTypography(page, '認証アプリ')
  99  |   await detailTypography(page, '回復コード')
  100 |   await detailTypography(page, '登録済み')
  101 |   await expect(page.getByText(/回復コードの残りが2個です/)).toBeVisible()
  102 |   await page.getByRole('heading', { name: '自分の二段階認証' }).scrollIntoViewIfNeeded()
  103 |   await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`personal-${width}.png`), fullPage: true })
  104 |   await page.getByRole('switch', { name: 'ログインで二段階認証を必須にする' }).click()
  105 |   const dialog = page.getByRole('dialog', { name: '二段階認証の必須をオフにしますか' })
  106 |   await expect(dialog).toBeVisible()
  107 |   await dialog.getByRole('textbox', { name: '1桁目' }).fill('123456')
  108 |   expect(writes).toBe(0)
  109 |   await page.screenshot({ animations: 'disabled', path: test.info().outputPath(`off-confirm-${width}.png`) })
> 110 |   await dialog.getByRole('button', { name: 'オフにする', exact: true }).click()
      |                                                                    ^ Error: locator.click: Test timeout of 60000ms exceeded.
  111 |   await expect.poll(() => writes).toBe(1)
  112 |   await expect(page.getByRole('switch', { name: 'ログインで二段階認証を必須にする' })).toHaveAttribute('aria-checked', 'false')
  113 |   await page.getByRole('button', { name: '回復コードを作り直す' }).click()
  114 |   await page.getByRole('dialog').getByRole('textbox', { name: '1桁目' }).fill('234567')
  115 |   await expect(page.getByRole('list', { name: '8個の回復コード' }).getByRole('listitem')).toHaveCount(8)
  116 |   await page.getByRole('button', { name: '控えました', exact: true }).click()
  117 |   await expect(page.getByText('残り 8 / 8 個', { exact: true })).toBeVisible()
  118 |   await expect(page.getByText(/回復コードの残りが2個です/)).toHaveCount(0)
  119 |   expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
  120 | })
  121 |
```
