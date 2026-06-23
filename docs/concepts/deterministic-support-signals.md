# Deterministic Support Signals

Deterministic support signals are local facts used to focus model review and
guard promotion decisions. Most signals are context and evidence only, not the
primary issue-discovery surface.

The signal stage may produce:

- changed-line and diff-hunk anchors;
- symbol spans and import/reference hints;
- related test, config, or documentation path hints;
- duplicate keys and baseline fingerprints;
- contradiction signals such as invalid line ranges, out-of-scope paths, or
  unchanged-only evidence.

Production setups are expected to run CodeQL, linters, formatters, unit tests,
and build checks in adjacent pipelines. CodeReviewer uses deterministic signals
to help the LLM investigate semantic risk and to reject weak or contradicted
claims. A small allowlist of trusted rule evidence can also seed actionable
deterministic candidates directly when the rule is local, narrow, and carries
its own evidence and remediation.

Generic support signals do not waive the proof path. A model-origin candidate
that overlaps support-signal evidence still needs a complete proof packet, a
proved refutation result, and normal admission before it can become actionable
or enter worker shared context. Model suggestions that cite the same evidence as
a trusted deterministic-rule candidate are treated as duplicates and dropped
before proof work.

Provider prompts receive compact, normalized signal summaries only. Raw AST
dumps, parser traces, rule-authoring notes, command output, source snippets, and
provider responses are not written to default logs or artifacts.

The no-content observability step is `deterministic_signals`. It records safe
metadata such as signal counts, evidence counts, supported extension counts, and
structural engine version when available.
