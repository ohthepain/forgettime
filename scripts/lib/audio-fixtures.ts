import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { decodeWav } from "./wav";

export const fixtureMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    file: z.string().min(1),
    provenance: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sampleRate: z.number().int().min(8000),
    channels: z.number().int().min(1).max(8),
    durationSeconds: z.number().positive().finite(),
    bpm: z.number().min(30).max(300).finite(),
    intendedPattern: z.string().min(1).nullable(),
    patternStatus: z.enum(["confirmed", "partial", "unknown"]),
    expectedGridSeconds: z.array(z.number().nonnegative().finite()).nullable(),
    renderOffsetSeconds: z.number().nonnegative().finite().nullable(),
    gridOriginStatus: z.enum(["confirmed", "assumed", "unknown"]),
    associationToleranceMs: z.number().positive().max(40).finite(),
  })
  .passthrough();

export type FixtureMetadata = z.infer<typeof fixtureMetadataSchema>;
export const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

/** Validate declarations against bytes; never repair metadata or infer intention. */
export function inspectFixture(bytes: Buffer, value: unknown, filename: string) {
  const parsed = fixtureMetadataSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }
  const metadata = parsed.data;
  if (basename(filename) !== filename || metadata.file !== filename)
    throw new Error("Metadata filename mismatch");
  if (sha256(bytes) !== metadata.sha256)
    throw new Error("WAV checksum changed: review the replacement and update provenance");
  const audio = decodeWav(bytes);
  const duration = audio.samples.length / audio.sampleRate;
  if (audio.sampleRate !== metadata.sampleRate || audio.channels !== metadata.channels)
    throw new Error("WAV format differs from metadata");
  if (Math.abs(duration - metadata.durationSeconds) > 0.5 / audio.sampleRate)
    throw new Error("WAV duration differs from metadata");
  if (audio.samples.some((sample) => !Number.isFinite(sample)))
    throw new Error("Fixture contains non-finite PCM");
  if ((metadata.gridOriginStatus === "unknown") !== (metadata.renderOffsetSeconds === null))
    throw new Error("Grid origin must be explicitly known, assumed, or null/unknown");
  if (metadata.renderOffsetSeconds !== null && metadata.renderOffsetSeconds >= duration)
    throw new Error("Grid origin is outside WAV");
  const expected = metadata.expectedGridSeconds;
  if (metadata.patternStatus === "unknown" && expected !== null)
    throw new Error("Unknown patterns must not invent expected hits");
  if (metadata.patternStatus !== "unknown" && (!expected?.length || !metadata.intendedPattern))
    throw new Error("Confirmed/partial patterns require expected positions and a description");
  for (const [index, time] of (expected ?? []).entries()) {
    if (time >= duration || (index && time <= expected![index - 1]))
      throw new Error("Expected positions must be ordered, unique and inside WAV");
    if (metadata.renderOffsetSeconds !== null) {
      const step = (time - metadata.renderOffsetSeconds) / (60 / metadata.bpm / 4);
      if (Math.abs(step - Math.round(step)) > 1e-6)
        throw new Error("Expected position is not on the declared sixteenth grid");
    }
  }
  return { metadata, ...audio };
}

export function readFixture(directory: string, filename: string) {
  if (basename(filename) !== filename || !filename.endsWith(".wav"))
    throw new Error("Select a WAV filename from test-data/audio");
  const bytes = readFileSync(join(directory, filename));
  const metadata = JSON.parse(
    readFileSync(join(directory, filename.replace(/\.wav$/, ".metadata.json")), "utf8"),
  );
  return inspectFixture(bytes, metadata, filename);
}

export function checkFixtureDirectory(directory: string): string[] {
  const entries = readdirSync(directory);
  const errors: string[] = [];
  const wavs = entries.filter((name) => name.endsWith(".wav")).sort();
  if (!wavs.length) errors.push("No WAV fixtures found");
  for (const name of wavs) {
    try {
      readFixture(directory, name);
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const name of entries.filter((name) => name.endsWith(".metadata.json"))) {
    if (!entries.includes(name.replace(/\.metadata\.json$/, ".wav")))
      errors.push(`${name}: source WAV is missing`);
  }
  return errors;
}
