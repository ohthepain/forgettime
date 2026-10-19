export type ReproEntry = { path: string; action: string; target?: string };
const sensitive =
  /pass(word)?|secret|token|credential|card|payment|billing|account|email|phone|address|birth|name|postal|personal/i;
export function safeName(element: Element) {
  const label =
    element.getAttribute("aria-label") ||
    element.getAttribute("title") ||
    (element instanceof HTMLInputElement ? element.labels?.[0]?.textContent : "") ||
    element.textContent ||
    element.tagName.toLowerCase();
  return label
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\S+@\S+/g, "[private address]")
    .replace(/\S+\.(wav|m4a|forget|mp3)\b/gi, "[audio file]")
    .replace(/[a-z0-9_-]{40,}/gi, "[identifier]")
    .slice(0, 110);
}
export function safeValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  const identity = [
    element.getAttribute("aria-label"),
    element.id,
    element.name,
    element.autocomplete,
  ].join(" ");
  if (element instanceof HTMLInputElement && element.type === "file")
    return `${element.files?.length ?? 0} selected audio/metadata file(s); names, paths and contents omitted`;
  if (
    sensitive.test(identity) ||
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement &&
      !["number", "range", "checkbox", "radio", "color"].includes(element.type))
  )
    return "[private text: supply a suitable value when reproducing]";
  if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type))
    return element.checked ? "on" : "off";
  if (element instanceof HTMLSelectElement)
    return sensitive.test(element.selectedOptions[0]?.textContent || "")
      ? "[private selection]"
      : [...element.selectedOptions]
          .map((option) => option.textContent?.trim() || "(option)")
          .join(", ")
          .slice(0, 120);
  return (
    element.value.slice(0, 80) +
    (element.validity.valid ? "" : " (invalid input; acceptance not observed)")
  );
}
export function safePath(path = location.pathname) {
  return new URL(path, 'https://local.invalid').pathname.replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi, "[id]").replace(/[^/]{60,}/g, "[id]");
}
export function targetIdentity(element: Element) {
  const id = element.getAttribute("data-testid") || element.id;
  return id
    ? `${element.tagName.toLowerCase()} [${id.replace(/[^\w:-]/g, "").slice(0, 80)}]`
    : element.tagName.toLowerCase();
}
const markdown = (value: string) =>
  value.replace(/[\r\n]+/g, " ").replace(/([\\`*_<>[\]])/g, "\\$1");
export class ReproJournal {
  entries: ReproEntry[] = [];
  startPath = "/";
  setup: string[] = [];
  reset(path: string, setup: string[]) {
    this.startPath = safePath(path);
    this.setup = setup;
    this.entries = [];
  }
  add(action: string, path: string, target?: string) {
    this.entries.push({ action, path: safePath(path), target });
  }
  report(expected: string, actual: string, notes: string) {
    const recipe =
      this.entries
        .map((entry, i) => `${i + 1}. ${markdown(entry.action)} (${markdown(entry.path)})`)
        .join("\n") || "No application actions were captured. Supply the missing steps in Notes.";
    return `# Repro: training waveform disappears after import\n\n## Starting page and setup\nPage: ${markdown(this.startPath)} (query, hash and origin omitted).\n${this.setup.map((value) => "- " + markdown(value)).join("\n")}\nUser-reported issue: training waveform disappears after import.\nOther prerequisites and the chosen file are unknown unless supplied in Notes.\n\n## Reproduction steps\n${recipe}\n\n## Expected behavior\n${expected || "(not provided)"}\n\n## Actual behavior\n${actual || "(not provided)"}\n\n## Failure point\nThe user selected “Bug reproduced” after the final captured action. This is a user-marked endpoint, not independently verified reproduction. The sequence has not been replayed or minimized; detours are retained.\n\n## Notes / missing setup\n${notes || "(none supplied)"}\n\n## Complete ordered semantic action log\n${this.entries.map((entry, i) => `${i + 1}. ${markdown(entry.action)} — page ${markdown(entry.path)}${entry.target ? "; target " + markdown(entry.target) : ""}`).join("\n") || "(empty)"}\n\n## Capture gaps\n- Native file-picker interaction, browser chrome, physical actions and external devices are not captured. File contents, private paths and filenames are omitted; describe the required audio in Notes.\n- Full document navigation/reload clears this in-memory recorder. Cross-origin pages, inaccessible frames and closed shadow roots are not covered.\n- Sensitive and arbitrary text fields are masked. Application acceptance and acoustic correctness are not inferred from input events.\n- Hover capture covers waveform markers; scroll and drag endpoints are approximate semantic observations, not a raw input replay.\n- No automatic saving, submission, upload, bug fix or issue-state change occurred.\n`;
  }
}
