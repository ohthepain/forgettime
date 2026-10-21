import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { report } from './token-usage.mjs';

test('uses snapshots without double counting and resets history after compaction', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'token-usage-'));
  const path = join(dir, 'session.jsonl');
  try {
    const usage = { input_tokens: 100, cached_input_tokens: 80, output_tokens: 10, total_tokens: 110 };
    const events = [
      { type: 'token_usage_record', payload: { usage, thread_token_usage: usage } },
      { type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: usage, total_token_usage: usage } } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: 'old history' } },
      { type: 'compacted', payload: { replacement_history: [{ type: 'message', role: 'user', content: 'new' }] } },
    ];
    await writeFile(path, events.map(JSON.stringify).join('\n') + '\n{"incomplete":');
    const result = await report(path);
    assert.deepEqual(result.cumulative, usage);
    assert.deepEqual(result.latest, usage);
    assert.equal(result.context_estimate.tokens_by_source['user messages'], 1);
    assert.equal(result.malformed_lines_skipped, 1);
    assert.equal(result.context_estimate.compacted, true);
  } finally { await rm(dir, { recursive: true }); }
});

test('missing usage remains unavailable rather than zero', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'token-usage-'));
  try {
    const path = join(dir, 'empty.jsonl');
    await writeFile(path, '');
    const result = await report(path);
    assert.equal(result.latest, null);
    assert.equal(result.cumulative, null);
  } finally { await rm(dir, { recursive: true }); }
});

test('deduplicates only matching base instructions and tracks catalog reads across compaction', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'token-usage-'));
  try {
    const path = join(dir, 'skills.jsonl');
    const entry = '- example: A skill: with punctuation. (file: r0/example/SKILL.md)';
    const unused = '- plugin:other: Another skill. (file: r0/other/SKILL.md)';
    const catalog = `### Skill roots\n- \`r0\` = \`/skills\`\n### Available skills\n${entry}\n${unused}\n</skills_instructions>`;
    const message = (role, text) => ({ type: 'response_item', payload: { type: 'message', role, content: [{ type: 'input_text', text }] } });
    const events = [
      { type: 'session_meta', payload: { base_instructions: { text: 'base' } } },
      message('developer', 'base'),
      message('developer', 'different instructions'),
      message('developer', catalog),
      message('assistant', 'I could read /skills/other/SKILL.md'),
      { type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'read', input: 'cat /skills/example/SKILL.md' } },
      { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'unrelated', output: 'name: other' } },
      { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'read', output: JSON.stringify({ output: '---\nname: "example"\n---\nInstructions' }) } },
    ];
    await writeFile(path, events.map(JSON.stringify).join('\n'));
    const before = await report(path);
    assert.equal(before.context_estimate.duplicate_base_instruction_messages_excluded, 1);
    assert.equal(before.context_estimate.tokens_by_source['base instructions'], 1);
    assert.equal(before.context_estimate.tokens_by_source.instructions, Math.ceil((JSON.stringify(events[2].payload.content).length + JSON.stringify(events[3].payload.content).length) / 4));
    assert.equal(before.skills.entries.find((s) => s.name === 'example').catalog_tokens_estimate, Math.ceil(entry.length / 4));
    assert.equal(before.skills.entries.find((s) => s.name === 'example').read_in_chat, true);
    assert.equal(before.skills.entries.find((s) => s.name === 'plugin:other').read_in_chat, false);
    events.push({ type: 'compacted', payload: { replacement_history: [message('developer', 'base').payload] } });
    await writeFile(path, events.map(JSON.stringify).join('\n'));
    const after = await report(path);
    assert.equal(after.context_estimate.tokens_by_source.instructions, undefined);
    assert.equal(after.skills.entries.find((s) => s.name === 'example').read_in_chat, true);
  } finally { await rm(dir, { recursive: true }); }
});
