# Forgettime

A microphone timing meter for drummers. Choose a tempo, enable the microphone, and play. Opening hits establish a reference; tempo and phase then stay fixed. Early hits sit left, late hits right, and each resolved line fades over one second. The beat counter follows the locked 4/4 clock, including pauses shorter than a full bar.

The charcoal card, large tempo, muted typography, rounded meter, and green centre band follow the supplied **Tempo Meter Design** screenshot. Auto, Straight, and Swing/triplet interpret short hit sequences. Ambiguous attacks get no precise score. The separate **Simulation** uses generated timestamps and does not access the microphone.

## Run locally

Node 22.12+ and pnpm 9.15.4 are required.

```sh
pnpm install
pnpm db:generate
pnpm dev
```

Open http://localhost:3030. Microphone practice works without an account or database. Browser microphone access requires HTTPS or localhost and AudioWorklet support. Audio stays on the device; the app neither uploads nor saves it.

On desktop, use the **Microphone** selector to choose your built-in or USB input. Device names may appear only after the first permission grant; stop listening, choose the input, then enable it again. The live-audio label shows the microphone actually in use. **Browser default** can select an iPhone Continuity microphone if that is the browser/system's preferred input. Brief browser input gaps clear the timing reference and resume listening automatically; actual captured silence still uses the full-bar pause rule. After updating capture code, reload the page to replace the running audio worklet.

For accounts, copy `.env.example` to `.env`, generate a unique `BETTER_AUTH_SECRET`, then:

```sh
pnpm db:up
pnpm db:migrate:deploy
pnpm dev
```

The local PostgreSQL database uses port 5434. Do not point local migrations at another project's database. Email/password accounts use Better Auth. Web Google OAuth, email verification, magic links and password reset are enabled when their own Google/SES settings are provided; email links are never printed to server logs. Do not copy Logmaster credentials. In-process auth rate limits are per application instance. Native Google sign-in is hidden until a native ID-token flow and Forgettime-specific OAuth clients are configured; email/password sign-in works in the native shell.

## Stack and structure

Versions follow the installed Logmaster stack and are pinned in the lockfile. Sailing, map, location and background-tracking features are excluded.

| Area | Implementation |
| --- | --- |
| Shared UI | React 19, TypeScript, TanStack Start/Router, Vite, Tailwind 4 |
| State | Zustand, locally persisted tempo and interpretation preference |
| Server | Hono API via TanStack server routes; Hono Node production server |
| Authentication | Better Auth, Prisma 7, PostgreSQL; optional Google and SES |
| Native shells | Capacitor 8, Android and iOS projects |
| Audio | Local Capacitor plugin: AudioRecord / AVAudioEngine; browser AudioWorklet |
| Timing | Sample-clock onset detector and fixed-reference short-sequence matcher |
| Tests | Vitest, synthetic PCM regression cases, cross-language detector parity |
| Delivery | GitHub Actions CI, Android APK/AAB workflows, Docker/ECS |
| Infrastructure | Terraform consumer of the existing shared-aws state |

## Native development

App identity is initially `app.forgettime.app`; confirm ownership before a first store release. Like Logmaster, the native shell loads a remote web deployment. The web UI is shared, while microphone capture and onset detection run natively.

```sh
CAP_REMOTE_APP_URL=https://your-forgettime-host.example pnpm cap:sync
pnpm cap:android
# or
pnpm cap:ios
```

For development use `CAP_DEV_SERVER_URL` with a reachable LAN development-server address. The development server can be bound using `pnpm dev --host 0.0.0.0`. The phone's `localhost` is the phone, not your computer. Without an app URL the shell shows an explicit setup page. This remote-shell model needs a network connection to open the app; it is not an offline cold-start implementation.

Android requires JDK 21 and SDK 36. iOS requires Xcode and signing for a physical device. Both apps declare microphone permission. Capture stops on backgrounding, interruption or a discontinuous audio stream. After an automatic musical pause, capture continues so new hits can establish a fresh reference.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm cap:sync
node --import tsx scripts/validate-auth.ts # isolated Docker PostgreSQL test
node --import tsx plugins/forgettime-audio/tests/validate-parity.ts
terraform -chdir=terraform init -backend=false
terraform -chdir=terraform validate
```

Run `pnpm build` once before standalone typechecking a clean checkout to generate the TanStack route tree (the generated route tree is also included in source control). Prisma client generation is required after installing dependencies.

See [audio validation](docs/audio-validation.md) for the annotated-WAV runner, full-bar timeout evidence and remaining acoustic-kit tests; [native audio](docs/native-audio.md) for capture clocks and platform limits; and [deployment](docs/deployment.md) for shared AWS onboarding and release workflows.

## Current verification boundary

The app has real microphone analysis code, not a simulation presented as recording. Synthetic fixtures verify invariants and native detector parity; they cannot establish accuracy with real drum kits, ghost notes masked by cymbals, room reflections or physical device latency. The opening sequence cannot determine an arbitrary musical downbeat: the first reliable attack anchors beat 1. Scoring includes a short interpretation delay, and low-confidence attacks are explicitly uncertain.

AWS resources have not been applied, no app has been published, and no Google/SES credentials have been configured. Native compilation is distinct from testing on physical microphones. See the validation documents for the measured checks and outstanding work.
