# Change Impact & Breaking-Change Analysis — Prior Art Review

Research for spec 22 (Change-Impact Review). Date: 2026-07-29.

**Verification key used throughout:**
- `[PRIMARY]` — I fetched the source itself (source file, tool docs, arXiv abstract page) and the numbers below are from it.
- `[PRIMARY-SUMMARISED]` — I fetched the primary document but the extraction was performed by the fetch summariser over a long page; names/numbers are reliable but I did not eyeball every row.
- `[SECONDARY]` — from a search-result summary only. Treat as a lead, not a fact.
- `[UNVERIFIED]` — sounds authoritative, I could not confirm. Flagged explicitly.

---

## 0. Executive summary

1. **The reusable prior art is the breaking-change taxonomy, and it is genuinely mature.** Four independent, production-grade tools (japicmp, Revapi, `cargo-semver-checks`, Go `apidiff`) have each converged on the *same structural idea* with different surface vocabulary: a change is classified not by what it is, but by **which consumer mechanism it breaks**. Section 2 gives the actual enumerations. Section 2.6 gives the language-neutral distillation I would actually implement.

2. **Classic CIA (slicing, call graphs, impact sets) is not usable and is largely dead as a live research programme.** The decisive number: mean static slice size is just under **30% of the program** (Binkley & Harman). An "impact set" that is 30% of the repo fails your bar catastrophically. Section 1.

3. **The precision lever validated at ecosystem scale is not better change detection — it is reachability filtering.** Only **7.9%** of Maven clients are affected by breaking changes despite breaking changes being ubiquitous; **2.54%** of clients in the Xavier study; **87%** of Maven library methods are used by no other library. The base rate of *actual* impact is very low. This is empirical support for your spec's "MUST be able to report no impact" requirement, and it says the adjudication step (b) is where all the precision lives — not step (a). Section 4.

4. **Even the mature, language-specific, complete-information tools are only ~0.86–0.91 F1** at classifying breaking changes (Roseau benchmark, 2025). That is the ceiling that decades of Java-specific bytecode analysis buys. A language-neutral heuristic layer will be below it. This is the strongest available argument for your spec's "evidence, not verdict" stance. Section 2.5.

5. **Behavioural change detection beyond signatures is where the actual defects are (68.1% of npm breaking changes), and it has essentially no working static tooling.** Everything that works is test-execution-based. Section 3.

6. **LLM-based breaking-change/impact analysis is thinner than you would hope — effectively nonexistent as published, measured work.** A 2026 systematic literature review covering 43 detection techniques reports *no* LLM-based detection approach in the literature and lists it as a future opportunity. Section 5. You have no baseline to steal and no baseline to beat; your spec's "beat grep" bar is therefore the right and only bar.

---

## 1. Classic change impact analysis (CIA)

### 1.1 What the field is

The canonical framing is Bohner & Arnold, *Software Change Impact Analysis*, IEEE CS Press, 1996 (ACM: `dl.acm.org/doi/10.5555/525066`) `[SECONDARY]` — this is the book everyone cites for the vocabulary you are using in the spec: **starting impact set (SIS)**, **estimated impact set (EIS)**, **actual impact set (AIS)**, and precision/recall of EIS against AIS.

The standard survey is:

> Bixin Li, Xiaobing Sun, Hareton Leung, Sai Zhang. **"A survey of code-based change impact analysis techniques."** *Software Testing, Verification and Reliability* (STVR) 23(8), 2013. DOI `10.1002/stvr.1475`.

`[SECONDARY]` — I could not fetch the PDF (domain blocked by the fetch tool's safety check). From search summaries the survey's structure is: static / dynamic / online (execute-and-observe) / history-based (mining) / hybrid, and it confirms that "accuracy (precision and recall) is the most widely used metric to evaluate CIA techniques." I did **not** verify individual numbers inside it and would not cite them without reading it.

### 1.2 The numbers that actually matter, and they are bad

**Static slicing — the classic "sound" approach.**

> David Binkley, Mark Harman. **"A large-scale empirical study of forward and backward static slice size and context sensitivity."** ICSM 2003, IEEE (`ieeexplore.ieee.org/document/1235405`). Also Binkley, Gold, Harman, **"An empirical study of static program slice size"**, ACM TOSEM 16(2), 2007, DOI `10.1145/1217295.1217297`.

`[SECONDARY]` (search summary of a very widely replicated result; I regard the headline number as safe, the sub-numbers as less so):
- 2,353,598 slices constructed over 43 C programs, just over 1 MLOC.
- **Mean slice size just under 30% of the program.**
- Ignoring calling context (i.e. the cheap, context-insensitive version — the only version you could plausibly afford) increases mean slice size by **50%**.

**Read this as:** a sound static impact set for one changed statement covers roughly a third of the codebase, and the cheap approximation covers roughly half. There is no configuration of slicing that produces a review-sized answer. This is the single most important negative result for your design. It is also why the field moved away from slicing for impact analysis and toward *ranking* rather than *set computation*.

**History-based / evolutionary coupling — tempting because it is language-neutral, but measured poorly.**

> Thomas Zimmermann, Peter Weißgerber, Stephan Diehl, Andreas Zeller. **"Mining Version Histories to Guide Software Changes."** ICSE 2004, pp. 563–572; extended as IEEE TSE 31(6), 2005, DOI `10.1109/TSE.2005.72`. PDF: `thomas-zimmermann.com/publications/files/zimmermann-tse-2005.pdf`.

`[SECONDARY]` (search summary; this is the paper's own headline claim and is quoted consistently): after an initial change, the ROSE prototype **correctly predicts 26% of further files to be changed, and 15% of the precise functions or variables.**

This matters to you specifically because co-change mining is the one CIA technique that is *perfectly* language-neutral and needs *no* parsing and *no* build — just `git log`. It is the obvious cheap thing to reach for. **Its measured precision at entity granularity is 15%.** At your precision bar that is unusable as a finding source. It might be usable as a *tie-breaker* or a confidence signal on an already-adjudicated finding, but never as a generator.

**Dynamic / execution-based CIA.** Requires running the program. Ruled out by your no-build constraint; not worth further space. One number circulating in survey summaries — "DistIA had 71.2% precision and 100% recall" — is `[UNVERIFIED]`; I could not trace it to a primary source and it appears to be a per-query dynamic result on distributed Java systems, i.e. not comparable to what you are doing. **Do not cite it.**

### 1.3 The one piece of classic CIA aimed at code review

> **"Enhanced code reviews using pull request based change impact analysis."** *Empirical Software Engineering* 30(3), 2025 (online May 2025). DOI `10.1007/s10664-024-10600-2`.

`[PRIMARY-SUMMARISED, incomplete]` — I fetched an open PDF copy (`d-nb.info/1364579286/34`) but the summariser could not reach the evaluation section. What I can state: it combines **call-graph dependency analysis with history mining**, operates at **pull-request granularity**, computes per-file metrics plus an **overall risk score**, and was validated via **two focus-group sessions** with a feature-feedback survey and tool demo — i.e. **qualitative validation, not a precision/recall measurement.** `[SECONDARY]` for the focus-group detail.

**Honest assessment:** this is the closest published work to what you are building, and it does not report the accuracy numbers you would want to compare against. It also does the two things you have ruled out (whole-repo call graph, co-change mining) and outputs a *risk score* rather than named dependents — which your spec explicitly and, I think, correctly rejects as the wrong output shape.

### 1.4 Verdict on classic CIA

**Steal:** the vocabulary (SIS/EIS/AIS, precision of EIS vs AIS) — it is exactly the right frame for your evaluation section, and it lets you state your corpus design in terms the literature already validates.

**Do not steal:** the techniques. Slicing is precision-fatal; call graphs violate no-index; dynamic analysis violates no-build; co-change mining measures 15%.

---

## 2. Breaking-change / API-evolution detection — the reusable taxonomy

This is the good stuff. Four independent implementations, three languages, all validated by production use over years.

### 2.1 japicmp (Java) — the full enumeration `[PRIMARY]`

Source: `github.com/siom79/japicmp`, file `japicmp/src/main/java/japicmp/model/JApiCompatibilityChangeType.java` (fetched and verified by direct download; **exactly 63 enum constants**). Each constant carries `(binaryCompatible, sourceCompatible, semanticVersionLevel)`.

This is the most valuable artefact in this whole document, because the two booleans *are* the "does the dependent rely on the part that changed" question, pre-answered by domain experts.

| Constant | binary-compat | source-compat | semver |
|---|---|---|---|
| ANNOTATION_ADDED | true | true | PATCH |
| ANNOTATION_DEPRECATED_ADDED | true | true | MINOR |
| ANNOTATION_MODIFIED | true | true | PATCH |
| ANNOTATION_REMOVED | true | true | PATCH |
| CLASS_REMOVED | false | false | MAJOR |
| CLASS_NOW_ABSTRACT | false | false | MAJOR |
| CLASS_NOW_NOT_EXTENDABLE | false | false | MAJOR |
| CLASS_NO_LONGER_PUBLIC | false | false | MAJOR |
| CLASS_TYPE_CHANGED | false | false | MAJOR |
| CLASS_NOW_CHECKED_EXCEPTION | true | **false** | MINOR |
| CLASS_LESS_ACCESSIBLE | false | false | MAJOR |
| CLASS_GENERIC_TEMPLATE_CHANGED | true | false | MINOR |
| CLASS_GENERIC_TEMPLATE_GENERICS_CHANGED | true | false | MINOR |
| SUPERCLASS_REMOVED | false | false | MAJOR |
| SUPERCLASS_ADDED | true | true | MINOR |
| SUPERCLASS_MODIFIED_INCOMPATIBLE | false | false | MAJOR |
| INTERFACE_ADDED | true | true | MINOR |
| INTERFACE_REMOVED | false | false | MAJOR |
| METHOD_REMOVED | false | false | MAJOR |
| METHOD_REMOVED_IN_SUPERCLASS | false | false | MAJOR |
| METHOD_LESS_ACCESSIBLE | false | false | MAJOR |
| METHOD_LESS_ACCESSIBLE_THAN_IN_SUPERCLASS | false | false | MAJOR |
| METHOD_IS_STATIC_AND_OVERRIDES_NOT_STATIC | false | false | MAJOR |
| METHOD_RETURN_TYPE_CHANGED | false | false | MAJOR |
| METHOD_RETURN_TYPE_COVARIANT_CHANGED | true | true | MINOR |
| METHOD_RETURN_TYPE_GENERICS_CHANGED | true | false | MINOR |
| METHOD_PARAMETER_GENERICS_CHANGED | true | false | MINOR |
| METHOD_NOW_ABSTRACT | false | false | MAJOR |
| METHOD_NOW_FINAL | false | false | MAJOR |
| METHOD_NOW_STATIC | false | false | MAJOR |
| METHOD_NO_LONGER_STATIC | false | false | MAJOR |
| METHOD_NOW_VARARGS | true | true | MINOR |
| METHOD_NO_LONGER_VARARGS | true | false | MINOR |
| METHOD_ADDED_TO_INTERFACE | true | false | MINOR |
| METHOD_ADDED_TO_PUBLIC_CLASS | true | true | PATCH |
| METHOD_NOW_THROWS_CHECKED_EXCEPTION | true | **false** | MINOR |
| METHOD_NO_LONGER_THROWS_CHECKED_EXCEPTION | true | **false** | MINOR |
| METHOD_ABSTRACT_ADDED_TO_CLASS | true | false | MINOR |
| METHOD_ABSTRACT_ADDED_IN_SUPERCLASS | true | false | MINOR |
| METHOD_ABSTRACT_ADDED_IN_IMPLEMENTED_INTERFACE | true | false | MINOR |
| METHOD_DEFAULT_ADDED_IN_IMPLEMENTED_INTERFACE | true | true | MINOR |
| METHOD_NEW_DEFAULT | true | true | MINOR |
| METHOD_NEW_STATIC_ADDED_TO_INTERFACE | true | true | MINOR |
| METHOD_MOVED_TO_SUPERCLASS | true | true | PATCH |
| METHOD_ABSTRACT_NOW_DEFAULT | false | false | MAJOR |
| METHOD_NON_STATIC_IN_INTERFACE_NOW_STATIC | false | false | MAJOR |
| METHOD_STATIC_IN_INTERFACE_NO_LONGER_STATIC | false | false | MAJOR |
| FIELD_STATIC_AND_OVERRIDES_STATIC | false | false | MAJOR |
| FIELD_LESS_ACCESSIBLE_THAN_IN_SUPERCLASS | false | false | MAJOR |
| FIELD_NOW_FINAL | false | false | MAJOR |
| FIELD_NOW_TRANSIENT | true | true | PATCH |
| FIELD_NOW_VOLATILE | true | true | PATCH |
| FIELD_NOW_STATIC | false | false | MAJOR |
| FIELD_NO_LONGER_TRANSIENT | true | true | PATCH |
| FIELD_NO_LONGER_VOLATILE | true | true | PATCH |
| FIELD_NO_LONGER_STATIC | false | false | MAJOR |
| FIELD_TYPE_CHANGED | false | false | MAJOR |
| FIELD_REMOVED | false | false | MAJOR |
| FIELD_REMOVED_IN_SUPERCLASS | false | false | MAJOR |
| FIELD_LESS_ACCESSIBLE | false | false | MAJOR |
| FIELD_GENERICS_CHANGED | true | false | MINOR |
| CONSTRUCTOR_REMOVED | false | false | MAJOR |
| CONSTRUCTOR_LESS_ACCESSIBLE | false | false | MAJOR |

**What to notice, because it generalises past Java:**
- The rows where the two booleans **disagree** are exactly the interesting cases. `METHOD_NOW_THROWS_CHECKED_EXCEPTION` is binary-compatible and source-incompatible: an already-compiled caller keeps working, a recompiled one breaks. Generalised: *the same contract change breaks different consumers depending on how they consume.* That is your step (b), and japicmp encodes it as a static table rather than a per-site judgement.
- Generics rows are almost all `(true, false)` — erased at runtime, checked at compile time. Generalised: **type-level changes break type-checked consumers and not others.** In a polyglot repo this is directly reusable: a TS type change breaks TS consumers, not the JS ones.
- A third of the enum is about *extension* (abstract/final/static/supertype), not *calling*. Signature-diffing alone misses this half.

### 2.2 Revapi (Java) — three compatibility axes `[PRIMARY-SUMMARISED]`

Source: `revapi.org/revapi-java/0.28.1/differences.html`, ~90+ difference codes. Revapi's advance over japicmp is a **third axis: SEMANTIC** (alongside BINARY and SOURCE), with values `Breaking / Potentially Breaking / Non-breaking / Equivalent / NA`.

The semantic column is what you need, and these are the rows where it fires:

| Difference code | binary | source | **semantic** |
|---|---|---|---|
| `java.field.constantValueChanged` | Non-breaking | Non-breaking | **Breaking** |
| `java.field.noLongerConstant` | Equivalent | Equivalent | **Breaking** |
| `java.field.serialVersionUIDChanged` | Equivalent | Equivalent | **Breaking** |
| `java.class.defaultSerializationChanged` | Equivalent | Equivalent | **Breaking** |
| `java.class.nonPublicPartOfAPI` | Non-breaking | Non-breaking | **Breaking** |
| `java.method.defaultValueRemoved` | Non-breaking | Breaking | **Breaking** |
| `java.method.attributeWithNoDefaultAddedToAnnotationType` | Non-breaking | Breaking | **Breaking** |
| `java.method.exception.runtimeAdded` | Non-breaking | Non-breaking | **Potentially Breaking** |
| `java.method.defaultValueChanged` | Non-breaking | Non-breaking | Potentially Breaking |
| `java.class.externalClassExposedInAPI` | Non-breaking | Non-breaking | Potentially Breaking |
| `java.field.enumConstantOrderChanged` | Non-breaking | Non-breaking | Potentially Breaking |
| `java.field.nowConstant` | Equivalent | Equivalent | Potentially Breaking |
| `java.annotation.added` / `.removed` / `.attributeValueChanged` / `.attributeAdded` / `.attributeRemoved` | Equivalent | Equivalent | Potentially Breaking |
| `java.annotation.nowInherited` / `.noLongerInherited` | Non-breaking | Non-breaking | Potentially Breaking |
| `java.generics.elementNowParameterized` | Non-breaking | Non-breaking | Potentially Breaking |

Also structurally interesting (verified in the same table):
- `java.class.nonFinalClassInheritsFromNewClass` → **Potentially Breaking** on both compile axes. A *superclass addition* can break subclasses by name collision. Cheap signature diffing never finds this.
- `java.method.exception.runtimeAdded` — "now throws an unchecked exception" — compiles fine everywhere, semantically breaking. **This is the single most transferable row in the whole document for a language-neutral reviewer**, because unchecked/runtime exceptions are the norm in Python, JS/TS, Go (panics), Ruby, and every dynamically-typed language. It is also visible in a diff as an added `throw`/`raise`/`panic`.
- `java.method.visibilityIncreased` → source-**Potentially Breaking** (widening visibility can create ambiguity). Counter-intuitive; shows the taxonomy was built from real bug reports, not from first principles.

**The "Potentially Breaking" level is the design pattern to steal wholesale.** Revapi ships a three-valued verdict where the third value means *"a dependent may or may not rely on this; a human must look."* That is precisely the output shape your spec commits to, and it means you do not have to make the taxonomy binary.

### 2.3 `cargo-semver-checks` (Rust) — 253 lints `[PRIMARY]`

Source: `github.com/obi1kenobi/cargo-semver-checks`, `src/lints/*.ron` — I enumerated the directory via the GitHub contents API: **253 lint files**, each a declarative query with a `required_update: Major|Minor` field and a configurable `deny`/`warn` level.

Full list is long; the *categories that do not exist in the Java tools* and that you should care about:

- **Exhaustiveness / construction**: `constructible_struct_adds_field`, `constructible_struct_adds_private_field`, `exhaustive_struct_added`, `enum_marked_non_exhaustive`, `enum_no_longer_non_exhaustive`, `enum_variant_added`, `enum_non_exhaustive_struct_variant_field_added`. **Adding a field or variant is breaking iff consumers construct or match exhaustively.** This generalises perfectly to TypeScript object literals, Python dataclasses, Go struct literals, and any `match`/`switch` over a closed set. Deterministically checkable at the reference site.
- **Ordering as contract**: `partial_ord_struct_fields_reordered`, `partial_ord_enum_variants_reordered`, `repr_c_plain_struct_fields_reordered`, `enum_repr_variant_discriminant_changed`. **Reordering declarations changes behaviour when order is semantic.** Language-neutral analogue: reordering enum members that get serialised by index, reordering positional parameters, reordering fields in a tuple/positional record.
- **Receiver/ownership**: `method_receiver_ref_became_mut`, `method_receiver_mut_ref_became_owned`, `method_receiver_ref_became_owned`, `method_no_longer_has_receiver`. This is **resource ownership as a first-class breaking-change category** — the only place in the surveyed tooling where it is mechanised. It is mechanised *because Rust puts ownership in the type*. Nowhere else can do this statically. Directly relevant to your spec's "resource ownership" bullet: **be aware there is no language-neutral prior art for it.**
- **Safety/effects**: `function_unsafe_added`, `function_no_longer_unsafe`, `static_became_unsafe`, `function_abi_now_unwind`/`no_longer_unwind`, `trait_method_now_unwind`. "This function may now panic/unwind" is a *declared* contract change in Rust. In every other language it is undeclared — and that is exactly the gap an LLM judge could fill from the diff body.
- **Sealed-trait lattice**: `trait_newly_sealed`, `pub_api_sealed_trait_became_unsealed`, `unconditionally_sealed_trait_became_pub_api_sealed`, `trait_no_longer_dyn_compatible`. Extension-point contracts, again.
- **Build-configuration contracts**: `feature_missing`, `feature_not_enabled_by_default`, `feature_newly_enables_feature`, `feature_no_longer_enables_feature`. **Breaking changes that live in the manifest, not the code.** Cheap, deterministic, language-neutral-in-shape (package.json exports/engines, go.mod, pyproject extras, Cargo features), and almost nobody checks them.
- **Documentation-visibility as API contract**: ~20 `*_now_doc_hidden` lints. Rust treats "removed from the public docs" as a semver event. Analogue: removing an export from a package's `exports` map or `__all__`.
- **Deprecation as a distinct, non-breaking-but-reportable event**: ~15 `*_marked_deprecated` lints, all `Minor`.

### 2.4 Go `apidiff` — the "what we deliberately do NOT report" list `[PRIMARY-SUMMARISED]`

Source: `golang.org/x/exp/apidiff`, README at `github.com/golang/exp/blob/master/apidiff/README.md`.

Go's tool is defined by a single operational predicate: **would this change cause client code to stop compiling?** — with an explicit, documented list of **five breakages it intentionally ignores**:

1. unkeyed struct literals (adding a field breaks positional construction)
2. embedding and shadowing (a new exported field can collide with an embedded one)
3. code that writes out an identical struct type expression
4. anything observable only via `unsafe.Sizeof`/`Offsetof`/`Alignof`
5. type switches, when two previously-distinct types are merged

Its correspondence rules are also worth noting: **many old types may correspond to one new type (merging is compatible), but one old type corresponds to at most one new type (splitting is not).** And for numeric types, widening is compatible only if the new type represents an equal-or-larger range **on both 32- and 64-bit architectures** — i.e. the contract is evaluated against *all* build configurations, not the current one.

**This is the most methodologically important tool in the set for you.** Go's authors decided that a precision-first tool must *publish the cases it declines to report*. That is a design pattern your spec should adopt verbatim: a documented "known-not-reported" list is what stops a low-recall tool from being perceived as a broken tool.

### 2.5 How accurate are these mature tools? `[PRIMARY]`

> Thomas Degueule et al. (see arXiv listing). **"Roseau: Fast, Accurate, Source-based API Breaking Change Analysis in Java."** arXiv:2507.17369, 2025.

Verified from the arXiv abstract page:
- On an extended and refined established benchmark of breaking changes: **Roseau F1 = 0.99, JApiCmp F1 = 0.86, Revapi F1 = 0.91.**
- Roseau builds API models **from source code or bytecode**, detects BCs between two versions **in under two seconds**, including in libraries with hundreds of thousands of lines of code.
- Applied to Guava over **14 years and 6,839 commits**, "reducing analysis times from a few days to a few minutes."

**Three conclusions for you:**
1. **japicmp — a decade-old, Java-specific, bytecode-complete tool — misclassifies about 14% (F1 0.86) on the taxonomy it itself defines.** Your language-neutral heuristic layer will not beat that. Plan the output shape (evidence, not verdict) around being worse than 0.86, because you will be.
2. **Source-based, no-build API modelling is validated as both feasible and fast.** Roseau explicitly moves off bytecode precisely because "reliance on binary JARs limits applicability" and blocks commit-level analysis. That is your architecture, independently arrived at, in a peer-reviewed setting. Cite it.
3. Sub-two-second per-version analysis means the *deterministic* half of your pipeline has no cost excuse to be slow.

### 2.6 The language-neutral distillation — the taxonomy I would actually encode

Intersecting japicmp (63) + Revapi (~90) + cargo-semver-checks (253) + Go apidiff + APIDiff (§2.7) + the npm empirical study (§3.1), stripping language mechanics, and grading each by *how decidable the reliance predicate is at a reference site without a build or an index*.

Columns: **Δ-detect** = can we detect the contract delta from the diff alone, language-neutrally? **Reliance** = can we decide whether a given reference site relies on it, from a bounded window around that site? Grades: **D** deterministic, **J** LLM judgement on a small window, **X** not decidable under our constraints.

#### A. Existence & identity
| # | Contract change | Δ-detect | Reliance |
|---|---|---|---|
| A1 | Symbol removed | D | D — every site breaks |
| A2 | Symbol renamed | D | D |
| A3 | Symbol moved (module/file/namespace) | D | D |
| A4 | Visibility reduced (public → internal/private) | D | D |
| A5 | Export removed from the package's public surface (`exports`, `__all__`, index re-export) | D | D |
| A6 | Symbol deprecated | D | D |

#### B. Input contract (call shape)
| # | Contract change | Δ-detect | Reliance |
|---|---|---|---|
| B1 | Required parameter added | D | D — count args at site |
| B2 | Parameter removed | D | D |
| B3 | Parameters reordered | D | D (positional) / J (named) |
| B4 | Optional parameter became required | D | D |
| B5 | Default value changed | D | J — does the site omit it? |
| B6 | Parameter type narrowed (accepts less) | D (typed langs) / J | J |
| B7 | Accepted option/flag/enum value removed | J | J |
| B8 | Input validation tightened | J | J |
| B9 | Variadic/spread arity changed | D | D |

#### C. Output contract
| # | Contract change | Δ-detect | Reliance |
|---|---|---|---|
| C1 | Return type changed | D (typed) / J | J |
| C2 | **Return nullability: non-null → nullable** | J | **J — is the result used without a guard?** |
| C3 | Return nullability: nullable → non-null | J | J — dead null-checks, changed control flow |
| C4 | Returned structure: field removed/renamed | D | D — is that field read at the site? |
| C5 | Returned structure: field added | D | J — only breaks exhaustive consumers |
| C6 | Return value added where there was none / removed | D | D |
| C7 | **Result ordering / sortedness / uniqueness changed** | J | **J — does the site index, take first/last, or compare?** |
| C8 | Units, encoding, or numeric range of result changed | J | J |
| C9 | Returned object mutability/ownership changed (now shared, now a view) | J | J |
| C10 | Sync → async (or Promise/Future/coroutine introduced) | D | D — is the call awaited? |

#### D. Error contract
| # | Contract change | Δ-detect | Reliance |
|---|---|---|---|
| D1 | **New error/exception thrown for previously-accepted input** | **D-ish — added `throw`/`raise`/`panic`/`return err` in the diff** | **J — is the site guarded?** |
| D2 | Error no longer thrown | D-ish | J — handler becomes dead, control flow shifts |
| D3 | Error type / code changed | D | D — does the site catch that type/code? |
| D4 | Error signalling mechanism changed (throw ↔ error-return ↔ null ↔ rejected promise) | J | J |

#### E. Effects, state, concurrency
| # | Contract change | Δ-detect | Reliance |
|---|---|---|---|
| E1 | Argument now mutated / no longer mutated | J | J — is the argument reused after the call? |
| E2 | Purity lost (now performs I/O, writes global state) | J | J |
| E3 | Idempotency lost | J | X |
| E4 | Ordering of side effects changed | J | X |
| E5 | Thread-safety / re-entrancy lost | J | X |
| E6 | Resource ownership moved (who closes/frees/disposes) | J | J — does the site also close it? |
| E7 | Lifecycle precondition added (must call init/configure first) | J | X |
| E8 | Blocking ↔ non-blocking | D-ish | J |

#### F. Extension contract (for anything a dependent subclasses/implements/overrides)
| # | Contract change | Δ-detect | Reliance |
|---|---|---|---|
| F1 | Required member added to an interface/protocol/trait/ABC | D | D — enumerate implementors |
| F2 | Type sealed / final / non-extendable | D | D |
| F3 | Default implementation removed | D | D |
| F4 | Supertype removed / interface no longer implemented | D | D |
| F5 | **Supertype added** (name collision in subclasses) | D | J |
| F6 | Kind changed (class↔interface, struct↔enum, function↔value) | D | D |
| F7 | Member made abstract / concrete | D | D |

#### G. Data & constants
| # | Contract change | Δ-detect | Reliance |
|---|---|---|---|
| G1 | Enum member removed/renamed | D | D |
| G2 | Enum member added (breaks exhaustive `switch`/`match`) | D | D — is the site exhaustive? |
| G3 | **Enum/constant serialised value or discriminant changed** | D | **J — persisted data, wire protocol** |
| G4 | Constant value changed | D | J (Revapi: semantically breaking, compile-invisible) |
| G5 | Field order changed where order is semantic | D | J |
| G6 | Serialisation format / schema changed | D-ish | J |

#### H. Configuration & environment
| # | Contract change | Δ-detect | Reliance |
|---|---|---|---|
| H1 | Feature/flag/extra removed | D | D |
| H2 | Feature no longer enabled by default | D | D |
| H3 | Minimum runtime/platform/engine raised | D | D |
| H4 | Dependency constraint tightened | D | D |

**The shape of the answer:** ~24 of these have a **deterministic or near-deterministic reliance predicate** (D in the reliance column), and those are the ones that can beat grep without an LLM at all. The LLM's job is the **J-reliance rows**, which are concentrated in C2/C3/C7, D1/D2, E1/E6, G3/G4 — a *small, enumerable* set. That is the argument against a context-hungry design: you do not need an open-ended judge, you need a classifier over ~10 named predicates evaluated on a window around one line.

### 2.7 APIDiff's catalogue — the compact research version `[PRIMARY]`

Source: `github.com/aserg-ufmg/apidiff` README. Useful because it is the taxonomy behind the most-cited empirical studies, and it is refactoring-shaped (reused from RefDiff) rather than compiler-shaped:

- **Type BC**: rename, move, move-and-rename, remove, lost visibility, add final, remove static, change in supertype, remove supertype.
- **Method BC**: move, rename, remove, push down, inline, change in parameter list, change in exception list, change in return type, lost visibility, add final, remove static.
- **Field BC**: remove, move, push down, change in default value, change in type, lost visibility, add final.
- **Non-breaking**: type add / extract supertype / gain visibility / remove final / add static / add supertype / deprecate; method pull up / gain visibility / remove final / add static / deprecate / add / extract; field pull up / add / deprecate / gain visibility / remove final.

**Worth stealing specifically:** `inline`, `push down`, `extract`, `pull up`, `move-and-rename`. These are *refactoring-shaped* deltas, and they are the ones a naive identifier-boundary search handles worst — a `move` looks like a removal plus an unrelated addition. Your deterministic layer should try to *pair* removals with additions before reporting, or it will report every refactoring as a deletion.

### 2.8 The language-neutral cousins: data & protocol contracts

**`buf breaking` (Protocol Buffers)** `[SECONDARY]`, docs at `buf.build/docs/breaking/rules/`. Four nested rule categories, strictest → most lenient: **FILE** (per-file generated-code breakage) ⊃ **PACKAGE** (per-package generated-code breakage) ⊃ **WIRE_JSON** (binary or JSON encoding breakage) ⊃ **WIRE** (binary only). Passing a stricter category implies passing every looser one.

**Why this matters more than it looks:** buf's taxonomy is organised entirely by **which consumer mechanism breaks** — and the categories form a *lattice*, so a maintainer declares which consumers they care about and the tool reports accordingly. Applied to your case: `source | test | generated | serialised-data | documentation` is exactly the classification you already built for reference-site destinations. buf validates the design, and suggests the natural next step: **let each contract-change kind declare which destination classes it can break.** A signature change cannot break a serialised-data consumer; an enum-discriminant change can, and cannot break a source consumer. That single table kills a whole class of false positive at zero LLM cost.

Adjacent, same shape, not investigated in depth here: `oasdiff` (OpenAPI), `graphql-inspector` (GraphQL schema) — both ship enumerated breaking-change lists organised by consumer effect. `[UNVERIFIED]` beyond their existence.

### 2.9 Per-language enrichment candidates (optional, not core)

Each of these does source-based, no-full-build API diffing, so each is a plausible *optional* per-language enrichment that would raise precision on the A/B/F rows for that language:

| Language | Tool | Notes |
|---|---|---|
| Java | **Roseau** (arXiv:2507.17369), japicmp, Revapi | Roseau works from **source**; F1 0.99, <2s `[PRIMARY]` |
| Rust | **`cargo-semver-checks`** | 253 lints; needs rustdoc JSON, i.e. a build `[PRIMARY]` |
| Go | **`golang.org/x/exp/apidiff`** | needs type-checking `[PRIMARY-SUMMARISED]` |
| Python | **Griffe** (`griffe check`, `mkdocstrings/griffe`) | **static analysis, does not import the code** — the best fit for a no-build reviewer `[SECONDARY]` |
| TypeScript | `@microsoft/api-extractor`, `attw` | needs `tsc` `[UNVERIFIED]` |

**My recommendation: do not wire any of these in.** They are a per-language dependency, a per-language install, and a per-language build step, in exchange for improving the rows you can already do deterministically. Note them in the spec as a rejected option with the reason, so it does not get re-proposed.

---

## 3. Behavioural / semantic change beyond signatures

### 3.1 The empirical case that this is where the defects are `[PRIMARY]`

> **"Towards Better Comprehension of Breaking Changes in the NPM Ecosystem."** arXiv:2408.14431 (journal version: ACM TOSEM, DOI `10.1145/3702991`).

Fetched from the arXiv HTML. Dataset: **1,519 breaking-change commits** from 381 sampled npm projects, spread over 131 distinct projects in six functional categories.

Eight top-level BC types — Rename, Remove, Move, Inline, Push Down, Change Signature (syntactic) and **Change Behavior** (behavioural).

- **Change Behavior is 68.1% of all BCs.** Move is 1.8%, Inline is 0.1%.
- Behavioural subcategories with counts:
  - **Changing option processing — 231 cases** (a previously-supported option value no longer accepted)
  - **Changing default behaviors — 203 cases** (how an unprovided parameter is handled)
  - **Changing return value specifications — 79 cases** (returned object type altered)
  - **Changing error handling — 42 cases** (how errors are detected or reported)

**This is the most directly actionable empirical finding in the whole review.** It says: in a dynamically-typed ecosystem — which is where a language-neutral tool spends most of its life — **roughly two thirds of breaking changes are invisible to signature diffing**, and the four things that matter are, in order: *option handling, defaults, return shape, error behaviour*. Rows B5/B7/B8, C1/C4, D1–D4 of §2.6. Nothing in that list requires whole-repo context. All four are visible **inside the diff hunk**.

### 3.2 The systematic literature review `[PRIMARY-SUMMARISED, preprint]`

> **"Breaking Changes in Software Ecosystems: A Systematic Literature Review."** arXiv:2605.24397.

⚠️ **Flag:** this is a recent preprint that I read via fetch; I have not verified its individual citations, and it discloses using an LLM to screen ~2,695 papers. Its *framework* is useful; its *numbers* are second-hand and I would re-derive any you plan to publish.

Its four-dimensional taxonomy is a good spine for your spec:
1. **Nature** — syntactic (violate type signatures/visibility) vs behavioural (alter runtime semantics, interface preserved)
2. **Detectability** — compile-time / link-time / runtime
3. **Scope** — direct vs transitive; widespread vs localised
4. **Visibility** — public / internal / beta-experimental / deprecated

Reported claims worth having, all `[SECONDARY]` via this preprint:
- 43 detection techniques surveyed; **18 of 21 Nature-related papers examine syntactic BCs, only 9 behavioural** — the research supply is inverted relative to the 68.1% demand.
- Techniques "reach high accuracy on syntactic breaks but limited coverage on behavioural ones."
- **The oracle problem** is named as the fundamental blocker for behavioural detection: ground truth requires expensive manual analysis or comprehensive test suites most projects lack. *This is exactly the constraint that produced your spec's "evidence bar: proven by upstream history" rule and your measured 1-usable-case-per-13,000-commits yield. The literature agrees that this corpus is expensive to build; that is not a failure of your mining.*
- **"Transitive changes account for approximately 20.36% of all client-impacting source breaking changes."** If accurate, this bounds what you lose by refusing transitive analysis: about a fifth. That is a defensible loss, and your per-reachability-class recall reporting will measure it directly.
- "87% of Maven methods unused by other libraries"; "API popularity does not predict the likelihood of being broken."
- Python-specific: **API element removal is 96.4%** of Python BCs — i.e. in Python the taxonomy collapses almost entirely to row A1. Cheap and deterministic.

### 3.3 What actually detects behavioural change, and it is all execution-based

**DeBBI** `[SECONDARY]`
> Lingchao Chen, Foyzul Hassan, Xiaoyin Wang, Lingming Zhang. **"Taming Behavioral Backward Incompatibilities via Cross-Project Testing and Analysis."** ICSE 2020. PDF: `lingming.cs.illinois.edu/publications/icse2020a.pdf`.

Runs *other projects' test suites* against two library versions, and reframes the "which client project to run next" problem as information retrieval to find breakages sooner. **Detected 97 BBI bugs, 19 confirmed as previously unknown.** Reduced end-to-end time to the first unique BBI by 99.1% for JDK. Requires executing arbitrary third-party test suites. Not adoptable.

**Behavioural BC impact at scale** `[SECONDARY]`
> **"Understanding the Impact of APIs Behavioral Breaking Changes on Client Applications."** *Proceedings of the ACM on Software Engineering* (FSE), 2024. DOI `10.1145/3643782`.

Updated dependencies automatically and ran client test suites across **30,548 dependencies under 8,086 Maven artifacts**. **2.30% of dependency updates contained a behavioural breaking change that impacted a client test**, and most BBC impacts occurred during **non-major** updates.

**Semantic differencing (the sound approach)** `[SECONDARY]`
> Suzette Person, Matthew B. Dwyer, Sebastian Elbaum, Corina S. Păsăreanu. **"Differential symbolic execution."** FSE 2008, DOI `10.1145/1453101.1453131`. Also **SYMDIFF** (Lahiri et al., CAV 2012), described as "a language-agnostic semantic diff tool for imperative programs" — language-agnostic only in the sense that it targets the Boogie IVL, i.e. you must first compile to Boogie.

Computes a precise behavioural characterisation of a change. Loop-free/recursion-free restrictions, requires symbolic execution infrastructure, requires a build. **Not adoptable and not close to adoptable.** Mentioning it mainly so it is on record as considered and rejected.

### 3.4 Honest verdict on §3

**Nullability, exception behaviour, ordering, thread-safety, resource ownership: there is no static, language-neutral tool for any of these, and the per-language ones only work where the language puts the property in the type system** (Rust ownership, Java checked exceptions, Kotlin/TS nullability). Everything else is caught by running tests.

That is the honest gap, and it is also the honest opportunity: **the LLM's differentiated capability here is reading a diff hunk and saying "this function now raises on empty input where it previously returned an empty list."** No static tool does that language-neutrally. That is a genuinely novel capability, not a reimplementation of prior art. But it is unmeasured, which is why your spec is right to gate it.

---

## 4. Reachability filtering — the validated precision lever

This is the finding I would build the design around.

**`[PRIMARY]` — Breaking Bad?**
> Lina Ochoa, Thomas Degueule, Jean-Rémy Falleri, Jurgen Vinju. **"Breaking bad? Semantic versioning and impact of breaking changes in Maven Central: An external and differentiated replication study."** *Empirical Software Engineering* 27(3):61, 2022. DOI `10.1007/s10664-021-10052-y`. arXiv:2110.07889.

Verified from the arXiv abstract page:
- **119,879 library upgrades, 293,817 clients.**
- **83.4% of upgrades comply with semantic versioning.**
- **Only 7.9% of clients are affected by breaking changes.**
- **"Most breaking changes impact code that no clients actually use."**
- Tool: **Maracas**, a static analyser that identifies (i) all BCs between versions and (ii) **the specific locations in client code impacted by each individual breaking change.**

**`[SECONDARY]` — Xavier et al.**
> Laerte Xavier, Aline Brito, Andre Hora, Marco Tulio Valente. **"Historical and impact analysis of API breaking changes: A large-scale study."** SANER 2017. PDF: `homepages.dcc.ufmg.br/~mtov/pub/2017-saner-breaking-apis.pdf` (I could not extract text from the PDF; numbers below are from a search summary that quotes the abstract consistently).
- **317 Java libraries, ~9,000 releases, ~260,000 clients.**
- **14.78% of API changes break compatibility.**
- **2.54% of clients are impacted.**

**The lesson, stated plainly:** the contract-delta step (a) has a *high* hit rate and the reliance step (b) has a *low* one. Roughly 15% of API changes are breaking; roughly 3–8% of dependents are actually affected. **If you skip step (b), your report is ~90% noise by construction — and you will have built a slower `grep`.** Conversely, an accurate step (b) is worth an order of magnitude in precision, which is exactly the multiplier your spec needs to clear its own bar.

Your first deterministic run already showed the shallow version of this (a third of reference sites were prose/fixtures) and you fixed it. §4 says the *deep* version of the same problem is larger: even among genuine source-code reference sites, most do not touch the part that changed.

**BreakBot — the closest thing to your product that exists** `[SECONDARY]`
> Lina Ochoa, Thomas Degueule, Jean-Rémy Falleri. **"BreakBot: Analyzing the Impact of Breaking Changes to Assist Library Evolution."** ICSE 2022 NIER. arXiv:2111.05132. Repo: `github.com/alien-tools/breakbot`.

A GitHub bot that, on every pull request to a Java library, statically analyses the PR **and a configured set of client projects**, then posts a check run listing the breaking changes and their impact on those clients. Built on Maracas.

**Two things to steal, one to reject:**
- Steal: the output contract — *objective usage data surfaced in the PR so the maintainer decides*, explicitly framed against "their own subjective perception of their community." This is verbatim your spec's "evidence, not verdict."
- Steal: **the set of dependents is configured, not discovered.** BreakBot does not go looking; a maintainer names the clients that matter. That is a bounded-by-construction design and worth considering as a config option (`impact.dependents: [...]`) for the monorepo case.
- Reject: it is a NIER (new-ideas) paper with no accuracy evaluation. Do not cite it as evidence that the approach works — cite it as evidence that the *output shape* is what practitioners converged on.

---

## 5. LLM-based impact / breaking-change analysis — thinner than you would hope

I searched specifically and repeatedly for this. Findings:

- **The 2026 SLR covering 43 detection techniques reports no LLM-based breaking-change detection approach in the literature at all** `[PRIMARY-SUMMARISED, preprint]`. It lists "LLM-Augmented Behavioral Contract Inference" as one of three *future* research opportunities (§7.2.1), framed as helping to "distinguish intentional improvements from regressions." The review itself uses an LLM only for paper screening.

- **"LLM Agents for Automated Dependency Upgrades"** — arXiv:2510.03480 `[SECONDARY]`. Summary/Control/Code agent architecture, localises library usages and applies fixes. Reported **precision 71.4%**. But this is the **repair** side, not the detection side, and validation was on **three synthetic repositories** built for the purpose. Very weak evidence; do not treat 71.4% as transferable to anything.

- **"LLM-Driven Cost-Effective Requirements Change Impact Analysis"** — arXiv:2511.00262 `[SECONDARY]`. Requirements-level CIA, not code. Adjacent at best.

- **"A Preliminary Study on Explaining Risk of Code Changes using LLM-Based Prediction Models"** — arXiv:2607.02782, AIware '26 `[SECONDARY]`. Just-in-time defect prediction plus LLM explanation. Produces a *risk score*, which is the output shape your spec rejects.

- One adjacent finding worth keeping in mind about LLM robustness on code: **semantic-preserving mutations cause LLMs to fail on previously-localised faults in 78% of cases** (arXiv:2504.04372, ICST 2026, 637 Python and 670 Java programs) `[SECONDARY]`. Not about impact analysis, but a caution that LLM judgements over code are less stable under irrelevant syntactic variation than one would hope — relevant to your known non-determinism band.

**Honest verdict:** there is no published, measured, LLM-based change-impact or breaking-change judge for code. You will not find a technique to copy, a prompt to steal, or a number to beat. The corollary is that your spec's decision rule — *beat naming the changed symbols and letting the human grep* — is not just a reasonable internal bar, it is the **only** available bar. Keep it.

---

## 6. What I would build, given your constraints

### 6.1 The architectural move: make step (a) a closed vocabulary, not free text

Right now the risk is that "what changed about the contract" becomes an open-ended LLM description, and then "does this site rely on it" becomes an open-ended LLM judgement over that description. Two free-text stages compose their errors and are unmeasurable per-category.

**Instead: make the contract delta a label from the §2.6 table.** The LLM's step-(a) job is *classification into ~40 named categories* (plus a per-category free-text detail field for the report), not description. This buys you four things, all of which you already care about:

1. **Per-category recall and precision.** Your spec already commits to per-reachability-class reporting; per-category is the other axis, and it is what tells you *"we are good at A/B/F and bad at E"* instead of one blended number — the exact blending failure your spec's Command Surface section is written to avoid.
2. **A per-category reliance predicate.** Each label carries a fixed question to ask at the reference site (§6.2). The judge prompt becomes short and specific, not open-ended — which is what your two net-negative context experiments argue for.
3. **A destination-class gate for free** (the buf idea, §2.8). Each category declares which destination classes it can break. An enum-discriminant change (G3) cannot break a source-only consumer that never serialises; a required-parameter addition (B1) cannot break a serialised-data consumer. Pure table lookup, zero cost, removes false positives your current pipeline would emit.
4. **Genericity by construction.** The category names are language-neutral, so your prompt-genericity guard has something concrete to guard.

### 6.2 The three tiers, and what to do with each

**Tier 1 — deterministic, ship first, no LLM.**
Categories where the reliance predicate is decidable from the reference site alone: **A1–A6, B1–B4, B9, C6, C10, F1–F4, F6, F7, G1, G2, H1–H4.**

For these, the finding is: *symbol X was removed/renamed/lost an argument; here are the N sites; every one of them breaks.* Precision is essentially 100% modulo your identifier-matching accuracy. **This alone beats grep**, because grep gives you sites and this gives you sites *plus a proven consequence*, with zero adjudication error.

I would ship this tier alone first and measure it. It is cheap, it is deterministic, and per §3.2 it covers **96.4% of Python breaking changes** and the entire Rename/Remove/Move/Signature portion of npm's taxonomy (~32%).

**Tier 2 — bounded LLM adjudication, the actual new capability.**
Categories where the delta needs judgement but the reliance predicate is answerable from a small window: **B5–B8, C1–C5, C7–C9, D1–D4, E1, E6, G3–G6.**

The adjudication unit should be: *one changed symbol's contract delta (one label + one sentence) × one reference site (± ~10 lines).* Not the whole dependent file. Not the whole changed file. Your prior evidence is that unbounded context is net-negative twice; this design has an inherent bound, and the bound is per-site rather than per-review, so it scales linearly and is cappable.

Concrete reliance questions, one per category — these are the entire judge prompt:
- C2 (non-null → nullable): *is the result used without a null/None/nil/undefined guard on this path?*
- C4 (returned field removed): *does this site read that field?*
- C5 (returned field added): *does this site enumerate/destructure/spread the result exhaustively?*
- C7 (ordering changed): *does this site index, take first/last, compare, or assume stability?*
- D1 (new error): *is this call inside a handler that catches this error?*
- D3 (error type changed): *does this site catch the old type/code specifically?*
- E1 (argument now mutated): *does this site read the argument after the call?*
- E6 (ownership moved): *does this site also close/free/dispose the resource?*
- G3 (serialised value changed): *does this site persist, transmit, or compare the raw value?*
- B7 (option value dropped): *does this site pass that option value?*

Note how each is a **yes/no question with a locally-visible answer**. That is what makes it precision-first rather than open-ended-hunt, and it is the structural difference from the five interventions your spec says have already failed.

**Tier 3 — do not build.**
E3, E4, E5, E7, plus all transitive impact. Not decidable without whole-program reasoning. Per the SLR, transitive accounts for ~20.36% of client-impacting source BCs `[SECONDARY]`. **Publish this as a known-not-reported list, Go-apidiff-style (§2.4).** A precision-first tool that documents its blind spots reads as disciplined; one that silently misses things reads as broken.

### 6.3 Two cheap additions with disproportionate payoff

**Pair removals with additions before reporting.** Per §2.7, `move`, `rename`, `move-and-rename`, `inline`, `push-down`, `extract`, `pull-up` are all common, and a naive symbol-level diff reports each as a *removal* — the most severe category — when the symbol is right there under a new name or in a new file. This is a pure false-positive source in your Tier 1, which is otherwise your highest-precision tier. Even a crude same-diff heuristic (a symbol removed here, a symbol with a similar body added there) would help.

**Read the manifest.** Rows H1–H4 (§2.6). `cargo-semver-checks` has four dedicated feature lints; nobody else checks this and it is deterministic, language-neutral in shape (`package.json` `exports`/`engines`/`peerDependencies`, `go.mod`, `pyproject.toml` extras, `Cargo.toml` features), and the dependents are named in the manifest itself. Cheap, high-precision, no LLM.

### 6.4 On your `low`-severity/threshold tension

Your spec records that four of the first seven expectations are `low` because change-impact damage is usually loud, and the actionable threshold is `medium`. The literature supports treating this as a **category error rather than a severity error**: japicmp/Revapi/cargo-semver-checks do not rate breaking changes on a severity scale at all — they rate them on a **compatibility axis** (binary/source/semantic; major/minor) and let the consumer decide. Revapi's `Potentially Breaking` is a *confidence* value, not a severity.

The clean resolution, consistent with your spec's refusal to relabel fixtures: **change-impact findings should not carry spec 05's severity at all.** They should carry a compatibility classification (`breaks-on-build` / `breaks-at-runtime` / `may-break` / `no-impact`) and be gated on that. This keeps spec 05's rubric intact (a loud failure genuinely is less severe than a silent one) while not forcing this capability through a gate calibrated for a different question. It also matches the "evidence, not verdict" commitment: a compatibility class is evidence; a severity is a verdict.

I flag this as a spec-level decision for the human, not something to change unilaterally.

---

## 7. What I would explicitly not build, and why

| Not building | Reason |
|---|---|
| **Program slicing / sound impact sets** | Mean static slice ≈ **30% of the program**; context-insensitive approximation is **+50%** on top (Binkley & Harman). An impact set that size is not a review artefact. |
| **Whole-repo call graph** | Violates no-index/no-build. The one published code-review application of it (EMSE 2025) reports no precision/recall and outputs a risk score, not named dependents. |
| **Co-change / evolutionary coupling mining** | Maximally tempting — language-neutral, no parsing, just `git log` — and measured at **26% precision at file level, 15% at entity level** (ROSE, ICSE 2004 / TSE 2005). Below your bar as a finding generator. Possible future use as a confidence signal on an already-adjudicated finding; never as a source. |
| **Dynamic / test-execution behavioural detection (DeBBI-style)** | The only thing that reliably finds behavioural BCs, and it requires running third-party test suites. Straight violation of the no-build constraint. |
| **Differential symbolic execution / regression verification (SYMDIFF, DSE)** | Sound, precise, requires compilation to an IVL, loop-free restrictions. Not close to adoptable; recorded as considered-and-rejected. |
| **Transitive / indirect dependent analysis** | ~**20.36%** of client-impacting source BCs `[SECONDARY]`, but unreachable without a graph. Report as a known-not-reported blind spot; your per-reachability-class recall will quantify the loss honestly. |
| **Per-language type-diffing tools as the core** (japicmp, cargo-semver-checks, apidiff, Griffe) | Each is a per-language install + usually a build. They would improve rows you can already do deterministically. Legitimate *optional enrichment* only; record the rejection so it is not re-proposed. |
| **A severity score or a risk score as primary output** | Both the strongest tool (BreakBot) and your own spec converged on named dependents + evidence. Every scoring approach in the literature (EMSE 2025 risk score, JIT-defect + LLM explanation) is the shape practitioners reportedly do not act on. |
| **Free-text contract-delta descriptions** | Unmeasurable per-category, composes errors across two LLM stages, and makes the genericity guard unenforceable. Use the closed vocabulary. |

---

## 8. Source list

**Primary sources I fetched directly:**
- japicmp `JApiCompatibilityChangeType.java` — `raw.githubusercontent.com/siom79/japicmp/master/japicmp/src/main/java/japicmp/model/JApiCompatibilityChangeType.java` (63 constants, downloaded and counted)
- Revapi difference codes — `revapi.org/revapi-java/0.28.1/differences.html`
- `cargo-semver-checks` lint directory — GitHub contents API, `obi1kenobi/cargo-semver-checks`, `src/lints` (253 `.ron` files)
- Go `apidiff` README — `github.com/golang/exp/blob/master/apidiff/README.md`
- APIDiff README — `github.com/aserg-ufmg/apidiff`
- Roseau — arXiv:2507.17369 (abstract page)
- Breaking Bad? — arXiv:2110.07889 (abstract page); DOI `10.1007/s10664-021-10052-y`
- npm BC study — arXiv:2408.14431 (HTML); TOSEM DOI `10.1145/3702991`
- BC systematic literature review — arXiv:2605.24397 (HTML) — **preprint, LLM-assisted screening, numbers second-hand**

**Cited from search summaries only (verify before publishing any number):**
- Li, Sun, Leung, Zhang, STVR 2013, DOI `10.1002/stvr.1475` — CIA survey
- Bohner & Arnold 1996 — CIA book, ACM `10.5555/525066`
- Binkley & Harman, ICSM 2003, `ieeexplore.ieee.org/document/1235405`; Binkley, Gold, Harman, TOSEM 2007, DOI `10.1145/1217295.1217297` — slice size
- Zimmermann, Weißgerber, Diehl, Zeller, ICSE 2004 / TSE 2005 DOI `10.1109/TSE.2005.72` — ROSE, 26%/15%
- Xavier, Brito, Hora, Valente, SANER 2017 — 14.78% / 2.54%
- Chen, Hassan, Wang, Zhang, ICSE 2020 — DeBBI
- FSE/PACMSE 2024, DOI `10.1145/3643782` — behavioural BC client impact, 2.30%
- Ochoa, Degueule, Falleri, ICSE-NIER 2022, arXiv:2111.05132 — BreakBot
- Person, Dwyer, Elbaum, Păsăreanu, FSE 2008, DOI `10.1145/1453101.1453131` — differential symbolic execution
- `buf.build/docs/breaking/rules/` — buf categories
- `mkdocstrings/griffe` — `griffe check`
- EMSE 2025, DOI `10.1007/s10664-024-10600-2` — PR-based CIA for code review (numbers not extracted)
- arXiv:2510.03480, arXiv:2511.00262, arXiv:2607.02782, arXiv:2504.04372 — LLM-adjacent

**Explicitly flagged as unverified — do not cite:**
- "DistIA had 71.2% precision and 100% recall" — appears in survey summaries, no primary source traced, and the setting (dynamic, distributed Java, per-query) is not comparable.
- `oasdiff` / `graphql-inspector` breaking-change taxonomies — existence assumed, contents not inspected.
- TypeScript enrichment tooling (`api-extractor`, `attw`) — not investigated.
