/** Actual Foundation/AVAudioFile host checks; no simulator or device activation. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
const temporary = mkdtempSync(join(tmpdir(), 'forgettime-ios-files-'))
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.error ?? result.stderr}`)
  console.log(result.stdout.trim())
}
try {
  for (const suite of ['files', 'decode']) {
    const binary = join(temporary, suite)
    run('swiftc', ['-module-cache-path', join(temporary, 'cache'), ...['NativeBarFiles', 'NativeAudioFileDecoder'].map(name => resolve(`plugins/forgettime-audio/ios/Sources/ForgettimeAudioPlugin/${name}.swift`)), resolve(`plugins/forgettime-audio/tests/ios-${suite}/main.swift`), '-o', binary])
    run(binary, [join(temporary, `data-${suite}`), resolve('tests/fixtures/bar-files/float32-partial')])
  }
} finally { rmSync(temporary, { recursive: true, force: true }) }
