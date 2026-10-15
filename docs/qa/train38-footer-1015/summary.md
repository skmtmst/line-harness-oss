| 仕事 | 工程 | 名前 | 結果 | 秒 | 理由 / 記録 |
|---|---:|---|---|---:|---|
| changes | 1 | actions/checkout@11d5960a326750d5838078e36cf38b85af677262 | 飛ばした | 0 | uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262（手元の準備を使用、cache は復元しない） |
| changes | 2 | Protect command-center owned documents | 成功 | 0.02 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/changes-02.log) |
| changes | 3 | Select the required test scope | 成功 | 0.09 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/changes-03.log) |
| changes | 4 | Reject whitespace errors in the PR diff | 成功 | 0.15 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/changes-04.log) |
| changes | 5 | Require a release-log entry | 成功 | 0.3 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/changes-05.log) |
| changes | 6 | Check shell syntax | 成功 | 0.06 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/changes-06.log) |
| changes | 7 | Check workflow YAML and run-step shell syntax | 成功 | 2.63 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/changes-07.log) |
| v8-screen-guard | 1 | actions/checkout@11d5960a326750d5838078e36cf38b85af677262 | 飛ばした | 0 | uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262（手元の準備を使用、cache は復元しない） |
| v8-screen-guard | 2 | Decide whether to run the screen guard | 成功 | 0.06 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-02.log) |
| v8-screen-guard | 3 | pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 | 飛ばした | 0 | uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1（手元の準備を使用、cache は復元しない） |
| v8-screen-guard | 4 | actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 | 飛ばした | 0 | uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020（手元の準備を使用、cache は復元しない） |
| v8-screen-guard | 5 | pnpm install --frozen-lockfile | 成功 | 10.32 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-05.log) |
| v8-screen-guard | 6 | Build the PR admin against the visual-qa mock API | 成功 | 766.21 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-06.log) |
| v8-screen-guard | 7 | Build the base admin against the same mock API | 成功 | 95.7 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-07.log) |
| v8-screen-guard | 8 | Install Chromium for the V8 screen guard | 成功 | 22.62 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-08.log) |
| v8-screen-guard | 9 | Start the mock API and serve the built admin | 成功 | 1.15 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-09.log) |
| v8-screen-guard | 10 | No V8 layout breaks at 1152, 1440 and 1920 | 成功 | 95.65 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-10.log) |
| v8-screen-guard | 11 | Broken fixtures must fail the V8 layout guard | 成功 | 64.76 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-11.log) |
| v8-screen-guard | 12 | Narrow preview opens once and preserves form input | 成功 | 66.03 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-12.log) |
| v8-screen-guard | 13 | Train 17 waitlist failure and inflow mouse regressions | 成功 | 13.77 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-13.log) |
| v8-screen-guard | 14 | Booking preview date agrees through settings and preview tabs | 成功 | 8.62 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-14.log) |
| v8-screen-guard | 15 | No new V8 layout or owner-rule defects (B-191 through B-218) | 成功 | 329.74 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-15.log) |
| v8-screen-guard | 16 | List row rules (B-190/193/194/195/198, with negative controls) | 成功 | 583.99 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-16.log) |
| v8-screen-guard | 17 | All admin page titles are 22px / 700 / 32px at 1440 | 成功 | 164.07 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-17.log) |
| v8-screen-guard | 18 | Speed measurement and reference policy controls | 成功 | 2.26 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-18.log) |
| v8-screen-guard | 19 | Common V8 speed checks (11 scenes, five medians) | 成功 | 220.07 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-19.log) |
| v8-screen-guard | 20 | Train 17 absolute targets | 成功 | 0.26 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-20.log) |
| v8-screen-guard | 21 | 2000 friends meet absolute speed targets | 成功 | 0.09 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-21.log) |
| v8-screen-guard | 22 | PERF-01 fixed list speed targets | 成功 | 0.2 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-22.log) |
| v8-screen-guard | 23 | Report speed reference results (including incomplete measurements) | 成功 | 0.09 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-23.log) |
| v8-screen-guard | 24 | Virtual table selection, keyboard and layout | 成功 | 8.88 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-24.log) |
| v8-screen-guard | 25 | Rich-menu label font sizes at three widths (m22a) | 成功 | 2.49 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-25.log) |
| v8-screen-guard | 26 | Upload V8 screen guard results | 成功 | 0.01 | ローカル成果物を保存: v8-screen-guard [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-26.log) |
| v8-screen-guard | 27 | Upload separate speed diagnosis traces | 飛ばした | 0.0 | 成果物のファイルが無い（警告） [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261015-105131-fcc71bb43d-21301/v8-screen-guard-27.log) |
