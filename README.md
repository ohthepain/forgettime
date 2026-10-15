# Forgettime

A microphone timing meter for drummers. Choose a tempo, enable the microphone, and play. The first strong transient establishes beat 1 immediately; tempo and phase then stay fixed. Early hits sit left, late hits right, and each resolved line fades over one second. The beat counter follows the locked 4/4 clock, including pauses shorter than a full bar.

The charcoal card, large tempo, muted typography, rounded meter, and green centre band follow the supplied **Tempo Meter Design** screenshot. Auto, Straight, and Swing/triplet interpret short hit sequences. Ambiguous attacks get no precise score. The separate **Simulation** uses generated timestamps and does not access the microphone.

## Commits

Before a commit you should run:
```sh
git diff --check
pnpm typecheck
pnpm test
pnpm build
```

## Run locally

Node 22.12+ and pnpm 9.15.4 are required.

```sh
pnpm install
pnpm dev
```

Open http://localhost:3030. Microphone practice works without an account or database. Browser microphone access requires HTTPS or localhost and AudioWorklet support. Audio stays on the device; the app neither uploads nor saves it.

Open the gear at the top right for **Start sensitivity**. Lower values require a firmer first hit and help avoid accidental starts; higher values allow softer starting hits. The default is 50%, saved on this device. The setting applies again after a full-bar pause, but never moves an active reference or filters quieter follow-up hits. The underlying transient/noise detector remains active at every setting.

**Metronome** has First bar (default), Always and Need help modes, plus mute. Your opening hit sets beat 1; clicks join on beat 2. Need help also plays the opening bar, then returns after four consecutive assessed beats beyond the **Timing help threshold** in Settings (100 ms by default), and goes quiet after four within it. Use headphones: speaker clicks leaking into the microphone can be detected as playing. Simulation remains silent. The browser advances clicks using its reported input/output delay estimates; restart listening after changing audio devices. Reload the browser after updating; native apps need the new plugin rebuilt. See [metronome behavior and limits](audio-validation.md#metronome-and-timing-help).

The **One bar** waveform shows captured microphone audio against beat guides 1–4. Its playhead wraps to the left at beat 1 and progressively overwrites the previous bar. Detected-hit markers use **blue → purple → red → orange → yellow** from soft to hard input peaks. The waveform uses a fixed amplitude scale; colours indicate microphone signal strength, not timing accuracy or calibrated drum loudness. After the full-bar silence timeout or Stop, the waveform holds the most recent complete bar that ended before the final detected hit, preserving the playing section rather than the trailing silence. Short takes are labelled Partial bar. Dashed lines show the current Start sensitivity peak level; this gates starting only, and transient/noise checks still apply. Only display envelopes are kept in memory; no playable recording is saved. Simulation has its own clearly labelled generated waveform. Native apps must be rebuilt after installing/syncing the waveform-capable audio plugin; an older build shows an unavailable message instead of fabricated audio.

On desktop, use the **Microphone** selector to choose your built-in or USB input. Device names may appear only after the first permission grant; stop listening, choose the input, then enable it again. The live-audio label shows the microphone actually in use. **Browser default** can select an iPhone Continuity microphone if that is the browser/system's preferred input. Brief browser input gaps clear the timing reference and resume listening automatically; actual captured silence still uses the full-bar pause rule. After updating capture code, reload the page to replace the running audio worklet.

For accounts, copy `.env.example` to `.env`, generate a unique `BETTER_AUTH_SECRET`, then:

```sh
pnpm db:up
pnpm db:migrate:deploy
pnpm dev
```

Schema changes go in `src/server/schema.ts`; run `pnpm db:generate` and commit the SQL and metadata in `drizzle/`, then apply with `pnpm db:migrate`. Generation requires no database connection.

The local PostgreSQL database uses port 5434. Do not point local migrations at another project's database. Email/password accounts use Better Auth. Web Google OAuth, email verification, magic links and password reset are enabled when their own Google/SES settings are provided; email links are never printed to server logs. Do not copy Logmaster credentials. In-process auth rate limits are per application instance. Native Google sign-in is hidden until a native ID-token flow and Forgettime-specific OAuth clients are configured; email/password sign-in works in the native shell.

## Stack and structure

Versions are pinned in the lockfile. The shared platform follows Logmaster; database access uses Drizzle ORM. Sailing, map, location and background-tracking features are excluded.

| Area | Implementation |
| --- | --- |
| Shared UI | React 19, TypeScript, TanStack Start/Router, Vite, Tailwind 4 |
| State | Zustand, locally persisted tempo and interpretation preference |
| Server | Hono API via TanStack server routes; Hono Node production server |
| Authentication | Better Auth, Drizzle ORM, PostgreSQL; optional Google and SES |
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
node --import tsx scripts/validate-auth.ts --legacy-schema # adoption of previous empty tables
node --import tsx plugins/forgettime-audio/tests/validate-parity.ts
terraform -chdir=terraform init -backend=false
terraform -chdir=terraform validate
```

Run `pnpm build` once before standalone typechecking a clean checkout to generate the TanStack route tree (the generated route tree is also included in source control). Drizzle uses the TypeScript schema directly; no client generation is needed.

See [audio validation](docs/audio-validation.md) for the annotated-WAV runner, full-bar timeout evidence and remaining acoustic-kit tests; [native audio](docs/native-audio.md) for capture clocks and platform limits; and [deployment](docs/deployment.md) for shared AWS onboarding and release workflows.

## Current verification boundary

The app has real microphone analysis code, not a simulation presented as recording. Synthetic fixtures verify invariants and native detector parity; they cannot establish accuracy with real drum kits, ghost notes masked by cymbals, room reflections or physical device latency. Play the starting hit on your intended downbeat: the first transient that passes Start sensitivity anchors beat 1. Scoring includes a short interpretation delay, and low-confidence attacks are explicitly uncertain.

AWS resources have not been applied, no app has been published, and no Google/SES credentials have been configured. Native compilation is distinct from testing on physical microphones. See the validation documents for the measured checks and outstanding work.
