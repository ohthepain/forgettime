#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

export async function report(path) {
  let latest = null;
  let cumulative = null;
  let timestamp = null;
  let window = null;
  let malformed = 0;
  let compacted = false;
  let baseInstructions = '';
  let duplicateBaseMessages = 0;
  const skills = new Map();
  const roots = new Map();
  const readCalls = new Map();
  const readEvidence = new Set();
  const messageText = (content) => typeof content === 'string' ? content
    : (content ?? []).map((part) => part.text ?? '').join('\n');
  const catalog = (text) => {
    for (const match of text.matchAll(/- `([^`]+)` = `([^`]+)`/g)) roots.set(match[1], match[2]);
    const section = text.match(/### Available skills\r?\n([\s\S]*?)(?=\n<\/skills_instructions>|$)/)?.[1];
    if (!section) return;
    for (const line of section.split('\n')) {
      const match = line.match(/^- ([\w-]+(?::[\w-]+)?): (.*) \(file: ([^)]+\/SKILL\.md)\)\s*$/);
      if (!match) continue;
      const [, name, , source] = match;
      const slash = source.indexOf('/');
      const root = roots.get(source.slice(0, slash));
      skills.set(name, { name, path: root ? root + source.slice(slash) : source, catalog_tokens_estimate: Math.ceil(line.length / 4) });
    }
  };
  const chars = {};
  const add = (key, value) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    chars[key] = (chars[key] ?? 0) + text.length;
  };
  const item = (p) => {
    if (p.type === 'message') {
      if (['system', 'developer', 'user'].includes(p.role)) catalog(messageText(p.content));
      if (['system', 'developer'].includes(p.role) && baseInstructions && messageText(p.content).trim() === baseInstructions.trim()) {
        duplicateBaseMessages++;
        return;
      }
      add(['system', 'developer'].includes(p.role) ? 'instructions' : `${p.role} messages`, p.content);
    } else if (/tool.*output|function_call_output/.test(p.type ?? '')) {
      add('tool results', p.output);
    } else if (/tool_call|function_call/.test(p.type ?? '')) {
      add('tool calls', p.arguments ?? p.input);
    } else if (p.type === 'additional_tools') {
      add('visible tool definitions', p);
    } else if (p.type === 'reasoning') {
      add('visible reasoning', p.summary ?? []);
    }
  };
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { malformed++; continue; }
    const p = r.payload ?? {};
    // Inspect tool calls and their matching outputs, not transcript mentions of skills.
    if (r.type === 'response_item' && /^(custom_tool_call|function_call)$/.test(p.type)) {
      const input = typeof (p.input ?? p.arguments) === 'string' ? (p.input ?? p.arguments) : JSON.stringify(p.input ?? p.arguments ?? '');
      if (/\b(cat|sed|head|read_file|readFile|read_text)\b/.test(input)) {
        readCalls.set(p.call_id ?? p.id, [...skills.values()].filter((skill) => input.includes(skill.path)).map((skill) => skill.name));
      }
    }
    if (r.type === 'response_item' && /^(custom_tool_call_output|function_call_output)$/.test(p.type)) {
      const output = typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? '');
      const normalized = output.replace(/\\+n/g, '\n').replace(/\\+(["'])/g, '$1');
      for (const name of readCalls.get(p.call_id) ?? []) {
        const shortName = name.split(':').at(-1);
        if (normalized.split('\n').some((line) => line.trim().replace(/^name:\s*["']?|["']$/g, '') === shortName && line.trim().startsWith('name:'))) readEvidence.add(name);
      }
    }
    if (r.type === 'token_usage_record' && p.usage) {
      latest = p.usage;
      cumulative = p.thread_token_usage ?? cumulative;
      timestamp = r.timestamp;
    }
    if (r.type === 'event_msg' && p.type === 'token_count' && p.info) {
      latest = p.info.last_token_usage ?? latest;
      cumulative = p.info.total_token_usage ?? cumulative;
      window = p.info.model_context_window ?? window;
      timestamp = r.timestamp;
    }
    if (r.type === 'session_meta' && p.base_instructions) {
      baseInstructions = p.base_instructions.text ?? p.base_instructions;
      add('base instructions', baseInstructions);
    }
    if (r.type === 'compacted') {
      compacted = true;
      for (const key of Object.keys(chars)) if (key !== 'base instructions') delete chars[key];
      if (Array.isArray(p.replacement_history)) p.replacement_history.forEach(item);
      else add('compaction summary', p.message ?? '');
    }
    if (r.type === 'response_item') item(p);
  }
  return {
    path, timestamp, latest, cumulative, model_context_window: window,
    context_estimate: {
      method: 'Visible serialized text characters / 4; rounded up per category.',
      scope: 'Logged context proxy through end of file, not the exact current model request.',
      source_attribution: 'ESTIMATED: logs do not provide exact history/instructions/tools attribution. Hidden instructions, tool schemas, images, truncation and tokenization are not fully represented. Categories do not reconcile to input tokens.',
      compacted, tokens_by_source: Object.fromEntries(Object.entries(chars).map(([k, v]) => [k, Math.ceil(v / 4)])),
      duplicate_base_instruction_messages_excluded: duplicateBaseMessages,
    },
    skills: {
      scope: 'Catalog entries observed in this log; read evidence spans the whole chat, including before compaction. Catalog costs are already included in context source estimates, not additional tokens.',
      read_detection: 'ESTIMATED: matches explicit catalog paths in file-reading tool calls with matching SKILL.md name frontmatter in their outputs. No observed read does not prove a skill was unused; indirect, aliased, partial or orchestrator reads may be missed.',
      catalog_tokens_estimate: [...skills.values()].reduce((sum, skill) => sum + skill.catalog_tokens_estimate, 0),
      entries: [...skills.values()].map((skill) => ({ ...skill, read_in_chat: readEvidence.has(skill.name) })).sort((a, b) => b.catalog_tokens_estimate - a.catalog_tokens_estimate || a.name.localeCompare(b.name)),
    },
    malformed_lines_skipped: malformed,
  };
}

async function findSession(id) {
  const root = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { const found = await walk(path); if (found) return found; }
      else if (entry.name.endsWith(`-${id}.jsonl`)) return path;
    }
  }
  const path = await walk(root);
  if (!path) throw new Error(`No session log found for ${id}. Pass --file PATH.`);
  return path;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: pnpm tokens [--file PATH | --session ID] [--json]\nDefaults to CODEX_THREAD_ID. Reads local logs only.');
    return;
  }
  let file;
  let id = process.env.CODEX_THREAD_ID;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') json = true;
    else if (['--file', '--session'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) {
      if (args[i++] === '--file') file = args[i]; else id = args[i];
    } else throw new Error(`Unknown or incomplete option: ${args[i]}`);
  }
  if (!file && !id) throw new Error('No CODEX_THREAD_ID. Pass --session ID or --file PATH.');
  const result = await report(file ?? await findSession(id));
  if (json) { console.log(JSON.stringify(result, null, 2)); return; }
  console.log(`Session log: ${result.path}\nLatest usage recorded: ${result.timestamp ?? 'unavailable'}`);
  const fields = ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'];
  console.log('\nUsage                          Latest call      Cumulative');
  for (const key of fields) console.log(`${key.padEnd(30)}${String(result.latest?.[key] ?? 'n/a').padStart(12)}${String(result.cumulative?.[key] ?? 'n/a').padStart(16)}`);
  console.log('\nCached input is a subset of input; reasoning output is a subset of output.');
  console.log(`Context window: ${result.model_context_window ?? 'unavailable'} tokens`);
  console.log('\nCurrent context proxy — ESTIMATED source attribution');
  for (const [key, tokens] of Object.entries(result.context_estimate.tokens_by_source)) console.log(`  ${key}: ~${tokens.toLocaleString()} tokens`);
  console.log(result.context_estimate.method, result.context_estimate.scope);
  console.log(result.context_estimate.source_attribution);
  console.log(`Excluded duplicate base-instruction messages: ${result.context_estimate.duplicate_base_instruction_messages_excluded}`);
  console.log(`\nSkills catalog — ESTIMATED: ~${result.skills.catalog_tokens_estimate.toLocaleString()} tokens (entries only)`);
  for (const skill of result.skills.entries) console.log(`  ${skill.name.padEnd(42)} ~${String(skill.catalog_tokens_estimate).padStart(4)}  ${skill.read_in_chat ? 'read observed' : 'no read observed'}`);
  console.log(result.skills.scope);
  console.log(result.skills.read_detection);
  if (result.malformed_lines_skipped) console.log(`Warning: skipped ${result.malformed_lines_skipped} malformed/incomplete lines.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
