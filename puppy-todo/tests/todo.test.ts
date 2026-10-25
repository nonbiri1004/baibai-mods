import { expect, test } from 'claude-code/testing'

import { FACES, byProject, mood, newId, parseItem, parsePrs, parseScan, projectOf, shown } from '../hooks/todo'

const NOW = Date.parse('2026-10-24T14:30:00Z')
const wrap = (recap: string, ask?: string) =>
  JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'mcp__ccd_turn__wrap_up', input: ask ? { recap, ask } : { recap } }] },
  })

test('ids sort by time and stay short', () => {
  const id = newId(NOW, () => 0.5)
  expect(id).toMatch(/^\d{8}-\d{4}-[0-9a-z]{4}$/)
})

test('a worktree belongs to its repo', () => {
  expect(projectOf('/Users/a/dev/Projects/lofi-puppy/.claude/worktrees/nervous-hertz-0421c7')).toBe('lofi-puppy')
  expect(projectOf('/Users/a/dev/Projects/baibai-tools')).toBe('baibai-tools')
})

test('hand-written items are read loosely, broken ones dropped', () => {
  expect(parseItem('{"id":"x","text":" merge #78 ","kind":"weird"}')).toMatchObject({
    text: 'merge #78',
    kind: 'todo',
    project: 'misc',
    status: 'open',
  })
  expect(parseItem('{"id":"x"}')).toBe(null)
  expect(parseItem('not json')).toBe(null)
})

test('open items first, done ones fade after a few days', () => {
  const list = shown(
    [
      { id: 'b', text: 'b', project: 'p', kind: 'todo', status: 'open', createdAt: '' },
      { id: 'a', text: 'a', project: 'p', kind: 'todo', status: 'open', createdAt: '' },
      { id: 'c', text: 'c', project: 'p', kind: 'todo', status: 'done', createdAt: '', doneAt: '2026-10-24T10:00:00Z' },
      { id: 'd', text: 'd', project: 'p', kind: 'todo', status: 'done', createdAt: '', doneAt: '2026-10-01T10:00:00Z' },
    ],
    NOW,
  )
  expect(list.map(i => i.id)).toEqual(['a', 'b', 'c'])
  expect(byProject([{ project: 'z' }, { project: 'a' }]).map(([p]) => p)).toEqual(['a', 'z'])
})

test('a question waits until something is typed after it', () => {
  const out = [
    '\x1e/p/one.jsonl',
    '{"type":"custom-title","customTitle":"Puppy notes"}',
    'U',
    wrap('Built it.', 'Merge the PR?'),
    '{"type":"pr-link","prUrl":"https://github.com/o/r/pull/3"}',
    'C:"cwd":"/x/lofi-puppy/.claude/worktrees/w"',
    '\x1e/p/two.jsonl',
    '{"type":"custom-title","customTitle":"Old talk"}',
    wrap('Asked.', 'Which one?'),
    'U',
    'C:',
  ].join('\n')
  const [one, two] = parseScan(out, new Map([['/p/one.jsonl', 5]]))
  expect(one).toMatchObject({ id: 'one', title: 'Puppy notes', project: 'lofi-puppy', recap: 'Built it.', ask: 'Merge the PR?', mtimeMs: 5 })
  expect(one?.prs).toEqual(['https://github.com/o/r/pull/3'])
  expect(two?.ask).toBe(undefined)
  expect(two?.recap).toBe('Asked.')
})

test('gh output becomes PR rows', () => {
  const prs = parsePrs('[{"number":78,"title":"Log","url":"https://x/78","isDraft":false,"repository":{"name":"baibai-tools"}}]')
  expect(prs).toEqual([{ repo: 'baibai-tools', number: 78, title: 'Log', url: 'https://x/78', isDraft: false }])
  expect(parsePrs('oops')).toEqual([])
})

test('the puppy says hello while you are waited on, and is happy when all is clear', () => {
  expect(mood(2, 5)).toBe('hello')
  expect(mood(0, 3)).toBe('calm')
  expect(mood(0, 0)).toBe('happy')
  // no headphones: the face has no ◖◗ ear cups
  expect(Object.values(FACES).join('')).not.toMatch(/[◖◗]/)
})
