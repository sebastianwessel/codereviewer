# Releasing

The release rule is one sentence: **whatever version `package.json` names on
`main` is the version that exists on npm.**

There is no release branch, no tag to push by hand and no `npm publish` anyone
runs locally. You bump the version, you merge, and CI does the rest — or refuses
to, loudly.

---

## Releasing a version

```bash
npm version patch --no-git-tag-version
```

`minor` and `major` work the same way. `--no-git-tag-version` matters: the tag
is created by CI **after** the publish succeeds, so a failed release never
leaves a tag pointing at a version that is not on the registry.

Commit the change, open a PR, get it merged. That is the whole process.

---

## What CI does

### On every pull request — `.github/workflows/pr-checks.yml`

Needs no secrets, so it runs on forks. In order, stopping at the first failure:

| Step | Command |
| --- | --- |
| Install | `npm ci` |
| Typecheck | `npm run lint` |
| Test | `npm test` |
| Build | `npm run build` |
| Generated schemas | `npm run generate:schemas:check` |
| Pack | `npm pack` |
| Smoke test | install the tarball into an empty directory and run the CLI |

Node comes from `.nvmrc` via `node-version-file`, so the workflow and your shell
cannot drift apart. There is no version matrix: `@purista/harness` requires
`>=24.15.0` and `engines.node` declares the same floor, so a second Node version
would only test a runtime this package refuses to install on.

### On every push to `main` — `.github/workflows/publish.yml`

**`check-version`** reads the version from `package.json` and asks the registry
whether it exists. That is the whole decision, and it is deliberately not a diff
against the previous commit:

- re-running a workflow whose publish step failed resumes instead of
  double-publishing;
- a revert followed by a fresh bump still releases;
- a push that changed no version does nothing and writes the reason into the job
  summary.

**`publish`** runs only when the version is new. It runs the full PR gate again
plus three release-only checks, and publishes the artefact it just proved:

| Step | Guards against |
| --- | --- |
| Verify release metadata | Publishing a public package with no licence, or with `private` reintroduced |
| `npm run audit:release` | A known high-severity advisory in a **shipped** dependency |
| Smoke test the packed artefact | A broken build reaching consumers |
| `npm sbom` | No supply-chain record for the release |

The smoke test installs the tarball into a temporary directory and runs the
binary. The CLI has no `--help` — unknown options are rejected on purpose, see
`src/cli/args.ts` — so the no-op invocations are:

- a bare call, which must exit `2` with a `usage_error`, proving the module
  graph loads and the argument contract holds;
- `codereviewer config validate`, which resolves the default configuration and
  contacts no provider;
- an `import` of both `exports` entry points.

`npm publish` is then given **that exact tarball**, not a fresh pack of the
working tree, so the bytes that were tested are the bytes that ship. It runs
with `--provenance`, which needs `id-token: write` and is what lets anyone
verify on npmjs.com which workflow run and which commit produced the artefact.

Only after the publish succeeds does CI tag `vX.Y.Z` and create a GitHub release
with generated notes, the tarball and the SBOM attached.

### Weekly — `.github/workflows/scorecard.yml`

OpenSSF Scorecard, required by `specs/08-dependencies-and-release.md` before
public distribution. It is not a release gate: it grades repository practice
rather than the artefact, and several of its checks depend on repository
settings a workflow cannot change.

---

## One-time setup

None of this works until a human does these.

| What | Where | Why |
| --- | --- | --- |
| `NPM_TOKEN` secret | Repository or the `npm` environment settings | An **automation** token on an account with publish rights to the `@sebastianwessel` scope. Granular tokens work; a token with 2FA-on-publish enforced does not |
| A `LICENSE` file and a `license` field in `package.json` | Repository root | The metadata gate fails the release without both. A public package with no licence is all-rights-reserved |
| Public repository | Repository settings | npm provenance and Scorecard's `publish_results` both require it |
| `npm` environment | Settings → Environments | Optional but recommended. The publish job already targets it, so adding a required reviewer turns every release into a manual approval |
| Branch protection on `main` | Settings → Branches | Require `PR checks / Verify` to pass. Without it the publish workflow is the first thing that ever runs the gate |

---

## Why the release cannot ship the wrong bytes

Three properties, each worth stating because each was a real hole:

**The build always matches the source.** `prebuild` deletes `dist/` before every
compile. `tsc` overwrites but never removes, so a renamed or deleted module used
to leave its old `.js` behind — one such orphan was in the tree when this
workflow was written, and `files: ["dist", "schema"]` would have shipped it.

**`npm pack` rebuilds.** `prepack` runs `npm run build`, so packing a stale tree
is not possible even from a laptop.

**The tarball is tested, then published.** Not rebuilt, not repacked.

---

## What ships

`files` is `["dist", "schema", "types"]`, plus the `README.md` and `package.json`
npm always includes. The tarball carries the compiled `.js` and `.d.ts` under
`dist/`, the two committed entry declarations under `types/` that the `exports`
map's `types` conditions point at, `schema/codereviewer-config.schema.json` and
the README. No tests, no fixtures, no evaluation corpora, no `.codereviewer/`,
no source maps.

`types/` is **not** build output and is not regenerated: `types/index.d.ts` and
`types/cli.d.ts` re-export `dist/` and exist to carry a
`/// <reference types="node" />` directive into the consumer's program. Three
shipped declarations name `Buffer` in a public type position, and without that
directive a consumer compiling against the package gets TS2591 errors raised
inside our own declarations. Dropping `types` from `files` reintroduces that.

Every packing step prints the full file list into the job summary. Read it if
you change `files`, `tsconfig.build.json` or where a module lives.

Two exclusions in `tsconfig.build.json` are load-bearing and easy to undo by
accident: `src/**/*.test.ts` with `src/shared/testing/**`, and
`src/domains/evaluation/change-impact-eval/change-impact-fixture.ts`, a
test-only fixture that cannot move under `shared/testing/` because it is typed
in terms of a domain and `shared` may not import from `domains`. The report
fixture used to need the same treatment for the same reason and now lives at
`src/shared/testing/report-fixture.ts`, where the directory rule covers it. A
new test helper placed next to production code will ship unless you add it
there too.

Source maps are off for the published build. `files` does not ship `src/`, so
every emitted `.js.map` pointed at paths absent from the tarball — half the
unpacked size, and no debugger could follow any of it. `tsconfig.json` still
emits working maps for local work.

---

## Rollback

Package-version rollback, per `specs/08-dependencies-and-release.md`. Publish a
new patch version that reverts the change. Do not unpublish: npm forbids
republishing a version number, so an unpublish burns the version permanently and
breaks every lockfile that already pinned it.

`npm deprecate @sebastianwessel/codereviewer@X.Y.Z "<reason>"` is the right tool
for warning people off a bad release.
