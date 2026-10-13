# Forgettime

A timing practice app for drummers, sharing the Logmaster platform stack. Keep sailing, mapping and geolocation dependencies out of this project.

## Product invariants

- Preserve the supplied Tempo Meter Design: charcoal rounded card, large BPM, subdued typography, green centre band, stationary early/late hit lines.
- Hit timestamps come from captured audio frames. UI, JavaScript callback arrival and wall-clock timing are never hit measurements.
- The first reliable transient above Start sensitivity establishes beat 1 immediately. Selected BPM and phase then stay fixed. Never track the player's drift to improve their score. Start sensitivity gates only starting/restarting; editing it must not reset an active reference or filter subsequent quieter hits.
- In 4/4, pause only after four beats of elapsed silence measured from the last detected hit. Keep the beat clock alive during shorter pauses. Restart acquisition after a full-bar pause.
- Every resolved scored hit gets an immutable line position and a one-second opacity animation. Presentation lifetime is separate from analysis time.
- Sequence interpretation allows rests and fills. Ambiguous attacks do not receive an invented precise timing score.
- Keep live audio and simulations visibly distinct. Synthetic tests and simulator builds are not evidence of physical-device or acoustic-kit accuracy.
- Microphone audio stays on-device. Do not introduce recording, storage, upload or background capture without a requested feature and explicit product handling.

## Architecture

- TanStack Start/React shared UI, Hono API, Better Auth, Prisma/PostgreSQL, Zustand and Capacitor.
- `shared-aws` owns shared VPC/ALB/listener/RDS. Forgettime consumes outputs and owns only its application resources. Never import shared resources into this Terraform state.
- Keep a separate database, role, migration history and application secrets per Forgettime environment. Never copy Logmaster credentials.
- Native plugin is a local `file:` dependency. Reinstall and sync after native changes before claiming the latest plugin compiled.
- See README.md and docs/ for setup, validation and current limitations.

## Verification

Use `pnpm db:generate`, `pnpm typecheck`, `pnpm test`, `pnpm build` as appropriate. For audio changes include detector parity and relevant sample-clock/silence tests. For infrastructure changes use Terraform validation and the non-destructive provisioning test. Live AWS operations and store releases are separate actions from building the project.
