# Forgettime

A timing practice app for drummers, sharing the Logmaster platform stack. Keep sailing, mapping and geolocation dependencies out of this project.

## Product invariants

- Preserve the supplied Tempo Meter Design: charcoal rounded card, large BPM, subdued typography, green centre band, stationary early/late hit lines.
- Hit timestamps come from captured audio frames. UI, JavaScript callback arrival and wall-clock timing are never hit measurements.
- For live takes, the first reliable detector-accepted attack establishes beat 1 immediately. Selected BPM and phase then stay fixed. Never track the player's drift to improve their score. Input gain multiplies future microphone samples before detection and retention without resetting the reference. Live capture uses shared detector defaults; Detection sensitivity tunes import/replay only. Rejected candidates do not score or extend the silence deadline.
- The microphone starts off. Explicit single-take capture releases it after four beats of elapsed silence from the last accepted hit; explicit Auto capture keeps listening for a fresh take. Shorter pauses preserve the clock. Review, replay and import stop capture and disable Auto.
- Replay analyzes retained PCM against its saved/confirmed BPM and phase, bypassing live acquisition and silence stopping. Start playback, change bars or change detector settings to begin a fresh run; retain detector state across loop repetitions and preserve original results separately.
- Every resolved scored hit gets an immutable line position and a one-second opacity animation. Presentation lifetime is separate from analysis time.
- Sequence interpretation allows rests and fills. Ambiguous attacks do not receive an invented precise timing score.
- Keep live audio and simulations visibly distinct. Synthetic tests and simulator builds are not evidence of physical-device or acoustic-kit accuracy.
- Keep the latest unsaved take in bounded memory and persist only explicitly saved bars as complete WAV/`.forget` pairs on-device. Export requires an explicit user action. No automatic uploads or background capture.
- For recording, replay, detector comparisons or file handling, read docs/take-review.md and docs/bar-files.md; for validation claims, read docs/recorded-workflow-validation.md.

## Architecture

- TanStack Start/React shared UI, Hono API, Better Auth, Drizzle/PostgreSQL, Zustand and Capacitor.
- `shared-aws` owns shared VPC/ALB/listener/RDS. Forgettime consumes outputs and owns only its application resources. Never import shared resources into this Terraform state.
- Keep a separate database, role, migration history and application secrets per Forgettime environment. Never copy Logmaster credentials.
- Native plugin is a local `file:` dependency. Reinstall and sync after native changes before claiming the latest plugin compiled.
- See README.md and docs/ for setup, validation and current limitations.

## Verification

Use `pnpm db:generate`, `pnpm typecheck`, `pnpm test`, `pnpm build` as appropriate. For audio changes include detector parity and relevant sample-clock/silence tests. For infrastructure changes use Terraform validation and the non-destructive provisioning test. Live AWS operations and store releases are separate actions from building the project.

## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues for `ohthepain/forgettime`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default triage roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.
