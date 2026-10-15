# Domain docs

Forgettime uses a single-context documentation layout:

- `GLOSSARY.md` at the repository root for agreed domain terms.
- `docs/adr/` for architecture decision records, using numbered Markdown files such as `0001-decision-title.md`.

## Before exploring

Read the root glossary and ADRs relevant to the area being changed. If these files do not exist, proceed silently. Do not create empty scaffolding or suggest writing them merely because they are absent. Domain-modeling work creates them when terms or decisions are actually resolved.

Use `AGENTS.md` for the app's operating constraints and architecture. Existing documentation remains authoritative for its scope:

- `README.md`: setup, stack and current verification boundary.
- `docs/audio-validation.md`: timing, detection, waveform and metronome behavior.
- `docs/native-audio.md`: native capture, clocks and platform limitations.
- `docs/deployment.md`: application deployment and shared AWS ownership.
- `docs/verification.md`: completed checks and their limits.

## Use consistent terms

When naming concepts in issues, designs, tests or implementation, use the glossary's definitions. Reconsider unfamiliar synonyms; record genuine gaps during domain-modeling work.

## Surface decision conflicts

If a proposal contradicts an existing ADR, identify the decision and explain why it should be reconsidered. Do not silently override it.
