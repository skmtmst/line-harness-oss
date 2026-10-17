| 仕事 | 工程 | 名前 | 結果 | 秒 | 理由 / 記録 |
|---|---:|---|---|---:|---|
| changes | 1 | actions/checkout@11d5960a326750d5838078e36cf38b85af677262 | 飛ばした | 0 | uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262（手元の準備を使用、cache は復元しない） |
| changes | 2 | Protect command-center owned documents | 成功 | 0.02 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/changes-02.log) |
| changes | 3 | Select the required test scope | 成功 | 0.09 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/changes-03.log) |
| changes | 4 | Reject whitespace errors in the PR diff | 成功 | 0.14 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/changes-04.log) |
| changes | 5 | Require a release-log entry | 飛ばした | 0.0 | 手元では回せない: 値が不明: github.event.pull_request.title |
| changes | 6 | Check shell syntax | 成功 | 0.06 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/changes-06.log) |
| changes | 7 | Check workflow YAML and run-step shell syntax | 成功 | 2.41 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/changes-07.log) |
| v8-screen-guard | 1 | actions/checkout@11d5960a326750d5838078e36cf38b85af677262 | 飛ばした | 0 | uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262（手元の準備を使用、cache は復元しない） |
| v8-screen-guard | 2 | Decide whether to run the screen guard | 成功 | 0.1 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-02.log) |
| v8-screen-guard | 3 | pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 | 飛ばした | 0 | uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1（手元の準備を使用、cache は復元しない） |
| v8-screen-guard | 4 | actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 | 飛ばした | 0 | uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020（手元の準備を使用、cache は復元しない） |
| v8-screen-guard | 5 | pnpm install --frozen-lockfile | 成功 | 9.43 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-05.log) |
| v8-screen-guard | 6 | Build the PR admin against the visual-qa mock API | 成功 | 87.27 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-06.log) |
| v8-screen-guard | 7 | Build the base admin against the same mock API | 成功 | 94.98 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-07.log) |
| v8-screen-guard | 8 | Install Chromium for the V8 screen guard | 成功 | 22.19 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-08.log) |
| v8-screen-guard | 9 | Start the mock API and serve the built admin | 成功 | 1.1 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-09.log) |
| v8-screen-guard | 10 | No V8 layout breaks at 1152, 1440 and 1920 | 成功 | 95.49 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-10.log) |
| v8-screen-guard | 11 | Broken fixtures must fail the V8 layout guard | 失敗 | 73.52 | exit 1 [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-11.log) |
| v8-screen-guard | 12 | Narrow preview opens once and preserves form input | 成功 | 66.38 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-12.log) |
| v8-screen-guard | 13 | Train 17 waitlist failure and inflow mouse regressions | 成功 | 13.84 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-13.log) |
| v8-screen-guard | 14 | Booking preview date agrees through settings and preview tabs | 成功 | 8.59 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-14.log) |
| v8-screen-guard | 15 | No new V8 layout or owner-rule defects (B-191 through B-218) | 失敗 | 329.87 | exit 1 [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-15.log) |
| v8-screen-guard | 16 | List row rules (B-190/193/194/195/198, with negative controls) | 失敗 | 593.48 | exit 1 [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-16.log) |
| v8-screen-guard | 17 | All admin page titles are 22px / 700 / 32px at 1440 | 成功 | 166.5 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-17.log) |
| v8-screen-guard | 18 | Speed measurement and reference policy controls | 成功 | 1.92 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-18.log) |
| v8-screen-guard | 19 | Common V8 speed checks (11 scenes, five medians) | 成功 | 101.85 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-19.log) |
| v8-screen-guard | 20 | Train 17 absolute targets | 成功 | 0.22 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-20.log) |
| v8-screen-guard | 21 | 2000 friends meet absolute speed targets | 成功 | 0.1 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-21.log) |
| v8-screen-guard | 22 | PERF-01 fixed list speed targets | 成功 | 0.22 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-22.log) |
| v8-screen-guard | 23 | Report speed reference results (including incomplete measurements) | 成功 | 0.1 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-23.log) |
| v8-screen-guard | 24 | Virtual table selection, keyboard and layout | 成功 | 9.26 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-24.log) |
| v8-screen-guard | 25 | Rich-menu label font sizes at three widths (m22a) | 成功 | 2.6 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-25.log) |
| v8-screen-guard | 26 | Upload V8 screen guard results | 成功 | 0.01 | ローカル成果物を保存: v8-screen-guard [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-26.log) |
| v8-screen-guard | 27 | Upload separate speed diagnosis traces | 飛ばした | 0.0 | 成果物のファイルが無い（警告） [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261016-055109-c66f9d9413-26742/v8-screen-guard-27.log) |
