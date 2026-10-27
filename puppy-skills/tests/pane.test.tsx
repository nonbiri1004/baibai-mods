import { expect, test } from 'claude-code/testing'

import type { View } from '../types'

const PANE = {
  plugin: 'puppy-skills',
  component: 'Pane',
  requestId: 'puppy-skills',
  props: {
    title: 'skills',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const VIEW: View = {
  skills: [
    { id: 'personal::nap', name: 'nap', description: 'Finds a sunny spot. Then naps a long time.', where: 'personal', group: '', dir: '', uses: [] },
    {
      id: 'repo:garden:dig-hole', name: 'dig-hole', description: 'Digs one hole. Never two.', where: 'repo', group: 'garden', dir: '',
      uses: [{ task: 'morning dig', when: '9:00 daily' }],
    },
  ],
  openIds: [],
  at: Date.parse('2026-10-27T10:00:00Z'),
  notes: [],
}

test('the pane: a card per place, the first sentence, a clock on the scheduled one', async ($, on) => {
  on('state.get', () => ({ value: { value: VIEW, version: 1 } }))
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /2 skills/ }))?.text).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'refresh' })).toBeTruthy()
    expect(await ui.find({ type: 'Box', key: 'card-personal' })).toBeTruthy()
    expect(await ui.find({ type: 'Box', key: 'card-repo-garden' })).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /only in garden/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /⏰ 9:00/ }))?.text).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /Never two/ })).toBeFalsy()
    await ui.unmount()
  }
})

test('unfolded: the whole description and the schedule', async ($, on) => {
  on('state.get', () => ({ value: { value: { ...VIEW, openIds: ['repo:garden:dig-hole'] }, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Never two/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /morning dig · 9:00 daily/ }))?.text).toBeTruthy()
  // read only: nothing to run
  expect(await ui.find({ type: 'Button', text: /run/ })).toBeFalsy()
  await ui.unmount()
})
