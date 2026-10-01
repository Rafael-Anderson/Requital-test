# p4-small-items: ci/guard-logical-properties

VERIFIED: `node tools/logical-properties-codemod.js --check` on origin/main exited 1 with exactly one finding: prose "`text-left`" in a comment in `admin/app/globals.css.test.ts:9`. Reworded the comment (no code/CSS change); --check now exits 0 (22 documented exceptions).
Added step "Logical-properties guardrail" to the `guardrails` job in `.github/workflows/ci.yml` (job name untouched; script is dependency-free, no install needed). YAML loads with python yaml; guardrails job name unchanged, 12 steps.
`admin/app/globals.css.test.ts` still passes.
