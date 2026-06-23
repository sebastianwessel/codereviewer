# Code Review Bench-Style Fixture Pack

This pack adapts the open Code Review Bench golden-comment shape into self-contained Codereviewer eval slices.
Each slice keeps PR-style metadata, severity-labeled semantic expectations, no-finding zones, and a minimal repository stub so the normal eval loader can execute it.

Source methodology: https://github.com/withmartian/code-review-benchmark
Source data license: MIT as published by the upstream repository.
Upstream copyright: Copyright (c) 2025 Martian (withmartian.com).

Run with:

```bash
npm run eval:semantic -- --slice-root eval/benchmarks/code-review-bench-style
```
