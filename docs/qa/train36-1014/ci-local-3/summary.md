| 仕事 | 工程 | 名前 | 結果 | 秒 | 理由 / 記録 |
|---|---:|---|---|---:|---|
| font-fixtures | 0 | setContent の寸法点検 | 成功 | 0 | 静的なリスク検出。Linux の字の再現ではない [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/font-fixtures.log) |
| changes | 1 | actions/checkout@11d5960a326750d5838078e36cf38b85af677262 | 飛ばした | 0 | uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262（手元の準備を使用、cache は復元しない） |
| changes | 2 | Protect command-center owned documents | 成功 | 0.02 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/changes-02.log) |
| changes | 3 | Select the required test scope | 成功 | 0.05 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/changes-03.log) |
| changes | 4 | Reject whitespace errors in the PR diff | 成功 | 0.09 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/changes-04.log) |
| changes | 5 | Require a release-log entry | 成功 | 0.14 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/changes-05.log) |
| changes | 6 | Check shell syntax | 成功 | 0.09 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/changes-06.log) |
| changes | 7 | Check workflow YAML and run-step shell syntax | 成功 | 2.46 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/changes-07.log) |
| repository-checks | 1 | actions/checkout@11d5960a326750d5838078e36cf38b85af677262 | 飛ばした | 0 | uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262（手元の準備を使用、cache は復元しない） |
| repository-checks | 2 | pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 | 飛ばした | 0 | uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1（手元の準備を使用、cache は復元しない） |
| repository-checks | 3 | actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 | 飛ばした | 0 | uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020（手元の準備を使用、cache は復元しない） |
| repository-checks | 4 | pnpm install --frozen-lockfile | 成功 | 10.04 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/repository-checks-04.log) |
| repository-checks | 5 | Guard shared pattern ownership (B-172) | 成功 | 16.02 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/repository-checks-05.log) |
| repository-checks | 6 | Build shared packages | 成功 | 7.36 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/repository-checks-06.log) |
| repository-checks | 7 | pnpm --filter @line-crm/db check:bootstrap | 成功 | 4.49 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/repository-checks-07.log) |
| repository-checks | 8 | Migration safety check | 成功 | 1.27 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/repository-checks-08.log) |
| repository-checks | 9 | Test database package | 飛ばした | 0.0 | if: false |
| repository-checks | 10 | Test the self-update engine | 成功 | 7.74 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/repository-checks-10.log) |
| repository-checks | 11 | Test the setup CLI | 成功 | 2.46 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/repository-checks-11.log) |
| repository-checks | 12 | pnpm test:scripts | 成功 | 8.46 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/repository-checks-12.log) |
| repository-checks | 13 | Typecheck repository scripts | 成功 | 2.23 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/repository-checks-13.log) |
| repository-checks | 14 | Test shared | 成功 | 3.84 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/repository-checks-14.log) |
| repository-checks | 15 | pnpm --filter liff typecheck | 成功 | 3.43 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/repository-checks-15.log) |
| repository-checks | 16 | pnpm --filter liff test | 成功 | 6.05 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/repository-checks-16.log) |
| worker-checks | 1 | actions/checkout@11d5960a326750d5838078e36cf38b85af677262 | 飛ばした | 0 | uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262（手元の準備を使用、cache は復元しない） |
| worker-checks | 2 | pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 | 飛ばした | 0 | uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1（手元の準備を使用、cache は復元しない） |
| worker-checks | 3 | actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 | 飛ばした | 0 | uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020（手元の準備を使用、cache は復元しない） |
| worker-checks | 4 | pnpm install --frozen-lockfile | 成功 | 11.31 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/worker-checks-04.log) |
| worker-checks | 5 | Build Worker dependencies | 成功 | 7.18 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/worker-checks-05.log) |
| worker-checks | 6 | pnpm --filter worker typecheck | 成功 | 23.81 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/worker-checks-06.log) |
| worker-checks | 7 | pnpm --filter worker test | 成功 | 167.26 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/worker-checks-07.log) |
| worker-build | 1 | actions/checkout@11d5960a326750d5838078e36cf38b85af677262 | 飛ばした | 0 | uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262（手元の準備を使用、cache は復元しない） |
| worker-build | 2 | pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 | 飛ばした | 0 | uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1（手元の準備を使用、cache は復元しない） |
| worker-build | 3 | actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 | 飛ばした | 0 | uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020（手元の準備を使用、cache は復元しない） |
| worker-build | 4 | pnpm install --frozen-lockfile | 成功 | 10.27 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/worker-build-04.log) |
| worker-build | 5 | Build Worker dependencies | 成功 | 7.58 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/worker-build-05.log) |
| worker-build | 6 | Build Worker | 成功 | 14.54 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/worker-build-06.log) |
| worker-build | 7 | Install browser for deployed LIFF entry guard | 成功 | 22.19 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/worker-build-07.log) |
| worker-build | 8 | Guard customer waitlist entry, theme and short actions (B-247 E3) | 成功 | 4.08 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/worker-build-08.log) |
| worker-build | 9 | Verify LIFF security headers and public SDK compatibility | 成功 | 0.99 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/worker-build-09.log) |
| web-checks | 1 | actions/checkout@11d5960a326750d5838078e36cf38b85af677262 | 飛ばした | 0 | uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262（手元の準備を使用、cache は復元しない） |
| web-checks | 2 | pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 | 飛ばした | 0 | uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1（手元の準備を使用、cache は復元しない） |
| web-checks | 3 | actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 | 飛ばした | 0 | uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020（手元の準備を使用、cache は復元しない） |
| web-checks | 4 | pnpm install --frozen-lockfile | 成功 | 10.17 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-checks-04.log) |
| web-checks | 5 | Build Admin dependencies | 成功 | 2.48 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-checks-05.log) |
| web-checks | 6 | pnpm --filter web exec next lint --report-unused-disable-directives-severity error | 成功 | 26.35 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-checks-06.log) |
| web-checks | 7 | node apps/web/scripts/verify-entity-pickers.mjs | 成功 | 2.09 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-checks-07.log) |
| web-checks | 8 | Reject restored legacy admin appearance | 成功 | 1.53 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-checks-08.log) |
| web-checks | 9 | pnpm --filter web typecheck | 成功 | 35.12 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-checks-09.log) |
| web-checks | 10 | pnpm --filter web test | 成功 | 274.6 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-checks-10.log) |
| web-checks | 11 | Install Chromium for the webhook runtime contract | 成功 | 21.91 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-checks-11.log) |
| web-checks | 12 | Webhook screen runtime contract on a real browser (#704, | 成功 | 43.93 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-checks-12.log) |
| web-checks | 13 | Upload webhook runtime contract failure context | 飛ばした | 0.0 | if: false |
| mcp-checks | 1 | actions/checkout@11d5960a326750d5838078e36cf38b85af677262 | 飛ばした | 0 | uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262（手元の準備を使用、cache は復元しない） |
| mcp-checks | 2 | pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 | 飛ばした | 0 | uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1（手元の準備を使用、cache は復元しない） |
| mcp-checks | 3 | actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 | 飛ばした | 0 | uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020（手元の準備を使用、cache は復元しない） |
| mcp-checks | 4 | pnpm install --frozen-lockfile | 成功 | 10.29 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/mcp-checks-04.log) |
| mcp-checks | 5 | Build MCP dependencies | 成功 | 2.1 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/mcp-checks-05.log) |
| mcp-checks | 6 | Test the SDK | 成功 | 1.88 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/mcp-checks-06.log) |
| mcp-checks | 7 | pnpm --filter @line-harness/mcp-server typecheck | 成功 | 2.43 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/mcp-checks-07.log) |
| mcp-checks | 8 | pnpm --filter @line-harness/mcp-server test | 成功 | 2.1 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/mcp-checks-08.log) |
| mcp-checks | 9 | pnpm --filter @line-harness/mcp-server build | 成功 | 0.61 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/mcp-checks-09.log) |
| docs-checks | 1 | actions/checkout@11d5960a326750d5838078e36cf38b85af677262 | 飛ばした | 0 | uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262（手元の準備を使用、cache は復元しない） |
| docs-checks | 2 | pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 | 飛ばした | 0 | uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1（手元の準備を使用、cache は復元しない） |
| docs-checks | 3 | actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 | 飛ばした | 0 | uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020（手元の準備を使用、cache は復元しない） |
| docs-checks | 4 | pnpm install --frozen-lockfile | 成功 | 10.31 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/docs-checks-04.log) |
| docs-checks | 5 | pnpm --filter docs test | 成功 | 2.0 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/docs-checks-05.log) |
| web-build | 1 | actions/checkout@11d5960a326750d5838078e36cf38b85af677262 | 飛ばした | 0 | uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262（手元の準備を使用、cache は復元しない） |
| web-build | 2 | pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 | 飛ばした | 0 | uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1（手元の準備を使用、cache は復元しない） |
| web-build | 3 | actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 | 飛ばした | 0 | uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020（手元の準備を使用、cache は復元しない） |
| web-build | 4 | actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830 | 飛ばした | 0 | uses: actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830（手元の準備を使用、cache は復元しない） |
| web-build | 5 | pnpm install --frozen-lockfile | 成功 | 10.59 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-build-05.log) |
| web-build | 6 | Build Admin dependencies | 成功 | 2.51 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-build-06.log) |
| web-build | 7 | pnpm --filter web build | 成功 | 89.31 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-build-07.log) |
| web-build | 8 | Install Chromium for the browser behavior tests | 成功 | 21.99 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-build-08.log) |
| web-build | 9 | Verify media permissions on the built admin | 成功 | 12.79 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-build-09.log) |
| web-build | 10 | Verify EC import list account-switch behavior on the built admin | 成功 | 9.05 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-build-10.log) |
| web-build | 11 | Upload EC import list failure context | 飛ばした | 0.0 | if: false |
| web-build | 12 | LINE notifications real-browser behavior (#678) | 成功 | 7.67 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-build-12.log) |
| web-build | 13 | Verify archived tag edit behavior on the built admin | 成功 | 6.3 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-build-13.log) |
| web-build | 14 | MFA auth input and button behavior at three widths | 成功 | 6.93 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-build-14.log) |
| web-build | 15 | Verify admin security headers and auth interactions | 成功 | 0.84 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-build-15.log) |
| web-build | 16 | Upload MFA browser failure context | 飛ばした | 0.0 | if: false |
| web-build | 17 | pnpm --filter web verify:design | 成功 | 2.1 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-build-17.log) |
| web-build | 18 | Install Chromium for browser checks | 成功 | 0.45 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-build-18.log) |
| web-build | 19 | Admin browser behavior checks | 成功 | 17.84 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/web-build-19.log) |
| v8-screen-guard | 1 | actions/checkout@11d5960a326750d5838078e36cf38b85af677262 | 飛ばした | 0 | uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262（手元の準備を使用、cache は復元しない） |
| v8-screen-guard | 2 | Decide whether to run the screen guard | 成功 | 0.1 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-02.log) |
| v8-screen-guard | 3 | pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 | 飛ばした | 0 | uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1（手元の準備を使用、cache は復元しない） |
| v8-screen-guard | 4 | actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 | 飛ばした | 0 | uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020（手元の準備を使用、cache は復元しない） |
| v8-screen-guard | 5 | pnpm install --frozen-lockfile | 成功 | 9.92 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-05.log) |
| v8-screen-guard | 6 | Build the PR admin against the visual-qa mock API | 成功 | 88.2 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-06.log) |
| v8-screen-guard | 7 | Build the base admin against the same mock API | 成功 | 92.84 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-07.log) |
| v8-screen-guard | 8 | Install Chromium for the V8 screen guard | 成功 | 21.48 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-08.log) |
| v8-screen-guard | 9 | Start the mock API and serve the built admin | 成功 | 1.12 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-09.log) |
| v8-screen-guard | 10 | No V8 layout breaks at 1152, 1440 and 1920 | 成功 | 95.46 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-10.log) |
| v8-screen-guard | 11 | Broken fixtures must fail the V8 layout guard | 成功 | 59.54 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-11.log) |
| v8-screen-guard | 12 | Narrow preview opens once and preserves form input | 成功 | 64.89 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-12.log) |
| v8-screen-guard | 13 | Train 17 waitlist failure and inflow mouse regressions | 成功 | 13.59 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-13.log) |
| v8-screen-guard | 14 | Booking preview date agrees through settings and preview tabs | 成功 | 8.54 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-14.log) |
| v8-screen-guard | 15 | No new V8 layout or owner-rule defects (B-191 through B-218) | 失敗 | 317.69 | exit 1 [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-15.log) |
| v8-screen-guard | 16 | List row rules (B-190/193/194/195/198, with negative controls) | 成功 | 628.74 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-16.log) |
| v8-screen-guard | 17 | All admin page titles are 22px / 700 / 32px at 1440 | 成功 | 163.15 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-17.log) |
| v8-screen-guard | 18 | Speed measurement and reference policy controls | 成功 | 2.18 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-18.log) |
| v8-screen-guard | 19 | Common V8 speed checks (11 scenes, five medians) | 成功 | 99.44 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-19.log) |
| v8-screen-guard | 20 | Train 17 absolute targets | 成功 | 0.25 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-20.log) |
| v8-screen-guard | 21 | 2000 friends meet absolute speed targets | 成功 | 0.09 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-21.log) |
| v8-screen-guard | 22 | PERF-01 fixed list speed targets | 成功 | 0.25 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-22.log) |
| v8-screen-guard | 23 | Report speed reference results (including incomplete measurements) | 成功 | 0.09 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-23.log) |
| v8-screen-guard | 24 | Virtual table selection, keyboard and layout | 成功 | 8.7 | [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-24.log) |
| v8-screen-guard | 25 | Upload V8 screen guard results | 成功 | 0.01 | ローカル成果物を保存: v8-screen-guard [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-25.log) |
| v8-screen-guard | 26 | Upload separate speed diagnosis traces | 飛ばした | 0.0 | 成果物のファイルが無い（警告） [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/v8-screen-guard-26.log) |
| required-pr-gate | 1 | Require every selected check to pass | 失敗 | 0.02 | exit 1 [log](/Users/kentakenta/lh-work/tools/hq/ci-local/logs/20261014-062752-d9aff5a7e5-37103/required-pr-gate-01.log) |
