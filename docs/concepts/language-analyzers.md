# Language Analyzers

Language analyzers convert source files into language-neutral facts without
executing project code.

## First-Class Languages

| Language | Extensions | Primary Facts |
| --- | --- | --- |
| TypeScript | `.ts`, `.tsx`, `.mts`, `.cts` | imports, exports, diagnostics, tests |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs` | imports, exports, diagnostics, tests |
| Python | `.py` | imports, declarations, public symbols, tests |
| Go | `.go` | packages, imports, declarations, exported symbols, tests |
| Rust | `.rs` | modules, uses, declarations, public symbols, tests |
| Java | `.java` | packages, imports, declarations, public symbols, tests |

## Analyzer Pipeline

```mermaid
flowchart TD
  File["Source File"] --> Detect["Language Detection"]
  Detect --> Parse["AST Parse"]
  Parse --> Facts["Language-Neutral Facts"]
  Parse --> Diagnostics["Diagnostics Evidence"]
  Facts --> Tests["Test Mapping"]
  Diagnostics --> Context["Shared Context"]
  Tests --> Context
  Facts --> Context
```

The AST layer uses `@ast-grep/napi`. TypeScript, JavaScript, Python, Go, Rust,
and Java are exposed as first-class analyzer adapters. Adapters may share parser
helpers, but registry dispatch routes files first and calls only the owning
adapter.

Each file has one analyzer owner based on its normalized repository-relative
path and extension. Unsupported paths are excluded before parser invocation, and
language-specific parsers reject mismatched paths at their public boundary. This
prevents a TypeScript or JavaScript file from being parsed by Python, Go, Rust,
or Java analyzers and prevents analyzer evidence from claiming a path the source
does not own. Facts are checked with the same ownership rule before they can
enter review task context or shared context.

## Fact Shape

Facts are normalized across languages:

| Field | Meaning |
| --- | --- |
| `language` | First-class language ID. |
| `kind` | `import`, `export`, `declaration`, `public-symbol`, or `module`. |
| `path` | Repository-relative file path. |
| `name` | Symbol, module, package, or imported name. |
| `moduleSpecifier` | Optional import/export target. |
| `line` | 1-based source line. |
| `contentHash` | SHA-256 of the analyzed file content. |
