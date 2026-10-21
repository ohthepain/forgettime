# Local Codex token usage

Run `pnpm tokens` in a Codex shell to select the current `CODEX_THREAD_ID`.
Outside Codex, use `pnpm tokens --session UUID` or
`pnpm tokens --file /absolute/path/to/rollout.jsonl`. Add `--json` for structured output.
Session discovery reads `$CODEX_HOME/sessions`, defaulting to `~/.codex/sessions`.
The command reads files locally and prints counters and estimates, never transcript content.

Latest-call and cumulative counters come from the latest available usage snapshots,
supporting both `token_usage_record` and `event_msg/token_count`. Cumulative snapshots
are not summed. Cached input is already included in input, and reasoning output in
output. Missing values display as unavailable. Counters may lag an in-flight call;
they cover the selected log, not other chats or agents.

Source attribution is **estimated**. The current context proxy groups visible logged
text by source and divides serialized character counts by four. It resets history
at logged compaction boundaries and uses replacement history or the summary when
available. This is not a model tokenizer or an exact reconstruction of the current
request. Hidden instructions, tool schemas, images, truncation, and context edits
can be absent or represented differently. Estimates can overcount or undercount,
do not reconcile to measured input, and are not billing or context-capacity figures.

Identical system/developer copies of the session metadata's base instructions are
excluded from the estimate. Other instruction messages remain counted, even when
they overlap partially. This corrects a log representation duplicate; it does not
assert that the actual model request contained duplicate instructions.

The skills table lists each observed catalog entry's estimated cost, largest first,
and whether a skill-file read was observed in this chat. Entry costs are already
part of the context estimates; do not add them again. Headers and root mappings
are excluded from the catalog-entry total. The JSON output includes paths and
per-entry values under `skills`.

Read detection matches explicit catalog paths in file-reading tool calls to skill
name frontmatter in the matching output. It does not execute commands or read skill
files itself. Detection is estimated: indirect paths, partial reads and orchestrator
tools may be missed; observed reads do not prove instructions were followed.
Catalog entries and read evidence span the whole log, including before compaction,
so they are not a guarantee that a skill's full text remains in current context.

Verify the parser with `node --test scripts/token-usage.test.mjs`.
