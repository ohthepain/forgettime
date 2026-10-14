import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
describe.skipIf(!process.env.FORGETTIME_NATIVE_HOST_TESTS)('actual Java private storage and decoder PCM', () => {
  let directory: string
  const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin') : ''
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'forgettime-android-files-'))
    execFileSync(join(java, 'javac'), ['-d', directory, ...['NativeBarStore', 'PcmFileWriter'].map(name => resolve(`plugins/forgettime-audio/android/src/main/java/app/forgettime/audio/${name}.java`)), resolve('plugins/forgettime-audio/tests/AndroidFilesRunner.java')])
  })
  afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }) })
  it('reopens exact portable pair bytes after restart and fails incomplete writes, quota, corruption and invalid PCM honestly', () => {
    expect(execFileSync(join(java, 'java'), ['-cp', directory, 'AndroidFilesRunner', join(directory, 'library'), resolve('tests/fixtures/bar-files/float32-partial.wav'), resolve('tests/fixtures/bar-files/float32-partial.forget')], { encoding: 'utf8' })).toContain('contracts passed')
  })
})
