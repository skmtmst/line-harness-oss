> 文書：OpenAPI definitions｜区分：今の説明｜最終確認：2026-10-19（日本時間）

# OpenAPI definitions

`../openapi.ts` keeps the public `openapi` export and serves `/openapi.json` and
`/docs`. `spec.ts` defines metadata, authentication schemes and tag ordering.
`schemas.ts` collects named schemas. `paths.ts` registers path definitions in
precedence order; the feature modules in this directory contain definitions only.
Runtime handlers and their middleware stay in the existing feature routes.

The older `../*-openapi.ts` modules remain public import points. Their exports
and position in the registry are retained. Some modules deliberately overlap:
a later path definition replaces the earlier **whole path item**, as before.
Do not sort or merge these entries by method without checking the full response.

When updating a contract, first confirm the matching handler exists in the same
revision, update its feature definition and run `openapi-coverage.test.ts` plus
its handler tests. Keep schema references, required parameters, authentication,
operation coverage and the unchanged-contract checks. Do not move missing routes
into the coverage allowlist.

A05 baseline: `f2c496cdf534e735bfaeb5cf93643629600e6c11`. The split returns exactly
the same JSON bytes and documentation HTML as this baseline. A07/A08 contracts
that are absent from this baseline must be applied together with those handlers;
the coordinator has the pending contract list in `CLEANUP-1017/A05-HANDOFF.md`.
