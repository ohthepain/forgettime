// @vitest-environment jsdom
import { expect, it } from "vite-plus/test";
import { ReproJournal, safeName, safePath, safeValue } from "./repro-journal";
it("masks private fields, preserves ordinary numeric settings, and never stores URL queries or file paths", () => {
  const password = document.createElement("input");
  password.type = "password";
  password.value = "secret-sentinel";
  password.setAttribute("aria-label", "Password");
  const email = document.createElement("input");
  email.type = "email";
  email.value = "private@example.test";
  const number = document.createElement("input");
  number.type = "number";
  number.setAttribute("aria-label", "Import tempo");
  number.value = "126";
  const file = document.createElement("input");
  file.type = "file";
  expect(safeValue(number)).toBe("126");
  expect(safeValue(password)).not.toContain("secret-sentinel");
  expect(safeValue(email)).not.toContain("private@example.test");
  expect(safeValue(file)).toContain("names, paths and contents omitted");
  const journal = new ReproJournal();
  journal.reset("/training", ["Import setup visible."]);
  journal.add(`Edit ${safeName(password)} to ${safeValue(password)}`, "/training");
  journal.add(`Edit Import tempo to ${safeValue(number)}`, "/training");
  journal.add("Choose Confirm tempo and beat one", "/training");
  journal.add("Choose Confirm tempo and beat one", "/training");
  const report = journal.report("Keep waveform", "Waveform missing", "Use a local WAV.");
  expect(report).not.toContain("secret-sentinel");
  expect(report).toContain("126");
  expect(journal.entries).toHaveLength(4);
  expect(report).toContain("not independently verified");
  expect(report).toContain("Complete ordered semantic action log");
  expect(safePath("/example/11111111-1111-4111-8111-111111111111")).toBe("/example/[id]");
});
it("clears the collection on restart, keeps repeated actions and rebuilds reports from current edits", () => {
  const journal = new ReproJournal();
  journal.reset("/", []);
  journal.add("Choose Training", "/");
  journal.add("Navigate to Training", "/training");
  journal.reset("/training", ["No import setup visible."]);
  expect(journal.entries).toEqual([]);
  expect(journal.startPath).toBe("/training");
  expect(journal.report("", "", "")).toContain("No application actions were captured");
  journal.add("Choose Import audio", "/training");
  journal.add("Choose Import audio", "/training");
  expect(journal.entries).toHaveLength(2);
  expect(journal.report("new expectation", "new actual behavior", "new notes")).toContain(
    "new actual behavior",
  );
});
