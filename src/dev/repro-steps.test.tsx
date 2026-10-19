// @vitest-environment jsdom
import { act, fireEvent, within } from '@testing-library/react'
import { expect, it, vi } from 'vite-plus/test'

it('captures simulated semantic events in order, masks secrets, flushes edits and keeps Restart active', async () => {
  const added = vi.spyOn(document, 'addEventListener')
  await act(async () => { await import('./repro-steps') })
  const host = document.getElementById('dev-repro-steps')!
  const ui = within(host.shadowRoot! as unknown as HTMLElement)
  fireEvent.click(ui.getByRole('button', { name: 'Start recording' }))
  function dispatch(type: string, name: string, target: Element, extra: Record<string, unknown> = {}) {
    const handler = [...added.mock.calls].reverse().find(call => call[0] === type && typeof call[1] === 'function' && call[1].name === name)?.[1] as EventListener
    expect(handler).toBeTruthy()
    // Simulated browser events in jsdom, not observed real-app interaction.
    handler({ type, isTrusted: true, target, composedPath: () => [target, document], ...extra } as unknown as Event)
  }
  const app = document.createElement('div'); document.body.append(app)
  const action = document.createElement('button'); action.textContent = 'Import audio'; action.dataset.testid = 'import-audio'; app.append(action)
  await act(async () => { dispatch('click', 'click', action); dispatch('click', 'click', action) })
  const number = document.createElement('input'); number.type = 'number'; number.setAttribute('aria-label','Import tempo'); app.append(number)
  await act(async () => { number.value = '12'; dispatch('input','changes',number); number.value = '126'; dispatch('input','changes',number); dispatch('focusout','blur',number) })
  const password = document.createElement('input'); password.type = 'password'; password.setAttribute('aria-label','Password'); password.value = 'never-record-this-secret'; app.append(password)
  await act(async () => { dispatch('input','changes',password); dispatch('focusout','blur',password) })
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.setAttribute('aria-label','Example enabled'); checkbox.checked = true; app.append(checkbox)
  await act(async () => { dispatch('input','changes',checkbox); dispatch('change','changes',checkbox) })
  const submit = document.createElement('button'); submit.textContent = 'Apply'; app.append(submit)
  await act(async () => { dispatch('click','click',submit); dispatch('submit','submit',submit,{submitter:submit}) })
  const guide = document.createElement('div'); guide.className = 'tutorial-panel'; const next = document.createElement('button'); next.textContent = 'Tutorial Next'; guide.append(next); app.append(guide)
  await act(async () => { dispatch('click','click',next) })
  await act(async () => { history.pushState({}, '', '/training?private=must-not-appear'); window.dispatchEvent(new Event('forgettime-route-changed')) })
  const finalNumber = document.createElement('input'); finalNumber.type = 'number'; finalNumber.setAttribute('aria-label','Beat one seconds'); finalNumber.value='0.25'; app.append(finalNumber)
  await act(async () => { dispatch('input','changes',finalNumber) })
  fireEvent.click(ui.getByRole('button', { name: 'Bug reproduced' }))
  let report = (ui.getByRole('textbox', { name: 'Selectable repro report' }) as HTMLTextAreaElement).value
  expect(report).not.toContain('never-record-this-secret')
  expect(report).not.toContain('must-not-appear')
  expect(report).not.toContain('Tutorial Next')
  const log = report.split('## Complete ordered semantic action log')[1].split('## Capture gaps')[0]
  expect(log.match(/Choose “Import audio”/g)).toHaveLength(2)
  expect(log.match(/Example enabled/g)).toHaveLength(1)
  expect(log.match(/Choose “Apply”/g)).toHaveLength(1)
  expect(log).toContain('126'); expect(log).not.toContain('to 12 ')
  expect(log).toContain('0.25'); expect(log).toContain('Navigate from / to /training')
  fireEvent.change(ui.getByRole('textbox', { name: 'Actual behavior' }), { target: { value: 'Latest user description' } })
  expect((ui.getByRole('textbox', { name: 'Selectable repro report' }) as HTMLTextAreaElement).value).toContain('Latest user description')
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:vi.fn().mockRejectedValue(new Error('unavailable'))}})
  await act(async () => { fireEvent.click(ui.getByRole('button', { name: 'Copy repro steps' })) })
  expect(ui.getByRole('status').textContent).toContain('Select and copy')
  fireEvent.click(ui.getByRole('button', { name: 'Restart' }))
  await act(async () => { dispatch('click','click',action) })
  // Restart while actively recording must reattach handlers too.
  fireEvent.click(ui.getByRole('button', { name: 'Restart' }))
  await act(async () => { dispatch('click','click',action) })
  fireEvent.click(ui.getByRole('button', { name: 'Bug reproduced' }))
  report = (ui.getByRole('textbox', { name: 'Selectable repro report' }) as HTMLTextAreaElement).value
  expect(report).toContain('Page: /training')
  expect(report).not.toContain('Beat one seconds')
  expect(report.split('## Complete ordered semantic action log')[1].match(/Choose “Import audio”/g)).toHaveLength(1)
  await act(async () => { dispatch('click','click',action) })
  expect((ui.getByRole('textbox', { name: 'Selectable repro report' }) as HTMLTextAreaElement).value).toBe(report)
  app.remove(); added.mockRestore()
})
