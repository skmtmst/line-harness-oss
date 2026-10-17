| 仕事 | 工程 | 名前 | 結果 | 秒 | 理由 / 記録 |
|---|---:|---|---|---:|---|
| changes | 1 | actions/checkout@11d5960a326750d5838078e36cf38b85af677262 | 飛ばした | 0 | uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262（手元の準備を使用、cache は復元しない） |
| changes | 2 | Protect command-center owned documents | 成功 | 0.02 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-155517-02c8591f83-76545/changes-02.log) |
| changes | 3 | Select the required test scope | 成功 | 0.15 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-155517-02c8591f83-76545/changes-03.log) |
| changes | 4 | Reject whitespace errors in the PR diff | 成功 | 0.2 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-155517-02c8591f83-76545/changes-04.log) |
| changes | 5 | Require a release-log entry | 飛ばした | 0.0 | 手元では回せない: 値が不明: github.event.pull_request.title |
| changes | 6 | Check shell syntax | 成功 | 0.06 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-155517-02c8591f83-76545/changes-06.log) |
| changes | 7 | Check workflow YAML and run-step shell syntax | 成功 | 2.11 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-155517-02c8591f83-76545/changes-07.log) |
| web-build | 1 | actions/checkout@11d5960a326750d5838078e36cf38b85af677262 | 飛ばした | 0.0 | --from / --until の範囲外 |
| web-build | 2 | pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 | 飛ばした | 0.0 | --from / --until の範囲外 |
| web-build | 3 | actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 | 飛ばした | 0.0 | --from / --until の範囲外 |
| web-build | 4 | actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830 | 飛ばした | 0.0 | --from / --until の範囲外 |
| web-build | 5 | pnpm install --frozen-lockfile | 成功 | 10.46 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-155517-02c8591f83-76545/web-build-05.log) |
| web-build | 6 | Build Admin dependencies | 成功 | 1644.98 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-155517-02c8591f83-76545/web-build-06.log) |
| web-build | 7 | pnpm --filter web build | 成功 | 80.2 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-155517-02c8591f83-76545/web-build-07.log) |
| web-build | 8 | Install Chromium for the browser behavior tests | 成功 | 22.15 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-155517-02c8591f83-76545/web-build-08.log) |
| web-build | 9 | Verify media permissions on the built admin | 成功 | 13.43 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-155517-02c8591f83-76545/web-build-09.log) |
| web-build | 10 | Verify EC import list account-switch behavior on the built admin | 成功 | 8.72 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-155517-02c8591f83-76545/web-build-10.log) |
| web-build | 11 | Upload EC import list failure context | 飛ばした | 0.0 | if: false |
| web-build | 12 | LINE notifications real-browser behavior (#678) | 成功 | 8.28 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-155517-02c8591f83-76545/web-build-12.log) |
| web-build | 13 | Verify archived tag edit behavior on the built admin | 成功 | 609.31 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-155517-02c8591f83-76545/web-build-13.log) |
| web-build | 14 | MFA auth input and button behavior at three widths | 失敗 | 184.99 | exit 1 [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-155517-02c8591f83-76545/web-build-14.log) |
| web-build | 15 | Verify admin security headers and auth interactions | 飛ばした | 0.0 | --from / --until の範囲外 |
| web-build | 16 | Upload MFA browser failure context | 飛ばした | 0.0 | --from / --until の範囲外 |
| web-build | 17 | pnpm --filter web verify:design | 飛ばした | 0.0 | --from / --until の範囲外 |
| web-build | 18 | Install Chromium for browser checks | 飛ばした | 0.0 | --from / --until の範囲外 |
| web-build | 19 | Admin browser behavior checks | 飛ばした | 0.0 | --from / --until の範囲外 |
