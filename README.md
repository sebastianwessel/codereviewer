# CodeReviewer

CodeReviewer is an evidence-first code review engine with typed workflow
orchestration, language-neutral analyzers, provider-optional model integration,
local artifacts, and CI-friendly quality gates.

## Table Of Contents

- [Quick Usage](#quick-usage)
- [Documentation](docs/)
- [Specifications](specs/)
- [Implementation Plan](plans/)

## Quick Usage

Use Node.js `>=24.15.0`.

```bash
nvm install
nvm use
npm install
cp .env.example .env
```

Validate and test:

```bash
npm run typecheck
npm test
npm run build
npx tsx src/cli/main.ts config validate
```

Run a local review for explicit files and execute the evaluation fixtures:

```bash
npx tsx src/cli/main.ts review --file src/app.ts
npx tsx src/cli/main.ts review --debug --file src/app.ts
npx tsx src/cli/main.ts eval run
```

Evaluation prints a readable summary and writes `.review/eval/eval-summary.md`
plus `.review/eval/eval-report.json`.

Provider adapters are optional peer packages. Install only the adapter used by
the configured provider:

```bash
npm install @purista/harness-openai
npm install @purista/harness-bedrock
npm install @purista/harness-azure-foundry
```

Start with [Quick Setup](docs/getting-started/quick-setup.md) for the full
setup path.
