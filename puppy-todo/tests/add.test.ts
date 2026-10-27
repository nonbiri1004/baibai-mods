import { expect, test } from 'claude-code/testing'

import type { Item, View } from '../types'

const NOW = Date.parse('2026-10-27T10:00:00Z')
const HOME = '/h'
const ITEMS = `${HOME}/.claude/todo/items`
// a PR item, merged: the shared answers (prs.json) know it, this pane's view doesn't yet
const old: Item = {
  schemaVersion: 2,
  id: '20261020-1000-aaaa',
  text: 'merge the notes PR',
  project: 'app',
  kind: 'todo',
  status: 'open',
  createdAt: '2026-10-20T10:00:00Z',
  source: { type: 'github-pr', host: 'github.com', repo: 'you/app', number: 8 },
  completion: { mode: 'source', condition: 'merged' },
}
const view = (): View => ({
  here: { id: 's1', title: 'notes', project: 'app', cwd: '/x' },
  talks: [],
  items: [old],
  prStates: {},
  convos: null,
  isShowingDone: false,
  isShowingConvos: false,
  isShowingAllAsks: false,
  isShowingInProject: false,
  openProjects: [],
  openItem: null,
  at: NOW,
  notes: [],
})

test('Codex #4: todo_add asks the shared PR answers, not only the view, before calling an item a twin', async ($, on) => {
  const files = new Map<string, string>([
    [`${ITEMS}/${old.id}.json`, JSON.stringify(old)],
    [`${HOME}/.claude/todo/prs.json`, JSON.stringify({ 'github.com/you/app#8': { state: { state: 'MERGED' }, checkedAt: NOW } })],
  ])
  on('state.get', () => ({ value: { value: view(), version: 1 } }))
  on('env.get', () => ({ value: HOME }))
  on('clock.now', () => ({ value: NOW }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/x' }))
  on('fs.exists', ($, e) => ({ value: e.path === ITEMS || files.has(e.path) }))
  on('fs.list', ($, e) =>
    ({ value: [...files.keys()].filter(p => p.startsWith(`${e.path}/`)).map(p => ({ name: p.slice(e.path.length + 1), kind: 'file' })) }) as never,
  )
  on('fs.read', ($, e) => (files.has(e.path) ? { value: files.get(e.path)! } : { error: { message: 'no file' } }) as never)
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined } as never
  })
  // the same PR again, after it merged: the old item is done, so this is a new one
  const got = await $.tool.call({ tool: 'mcp__puppy-todo__todo_add', text: 'merge the notes PR', pr: 'https://github.com/you/app/pull/8' } as never)
  expect(JSON.stringify(got)).not.toContain('already on the list')
  expect([...files.keys()].filter(p => p.startsWith(`${ITEMS}/`)).length).toBe(2)
})
