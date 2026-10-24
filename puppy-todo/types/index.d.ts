// one to-do in the shared list: ~/.claude/todo/items/<id>.json
export type Item = {
  id: string
  text: string
  // the repo or project it belongs to, e.g. lofi-puppy
  project: string
  // todo: the person does it; ask: a question waiting for the person; later: a conversation said it would do it later
  kind: Kind
  status: 'open' | 'done'
  // the conversation that wrote it, when known
  session?: { id?: string; title?: string; cwd?: string }
  // a PR, issue or doc it points at
  link?: string
  // claude, codex or the person
  by?: string
  createdAt: string
  doneAt?: string
}

export type Kind = 'todo' | 'ask' | 'later'

// what one conversation's transcript says right now
export type Talk = {
  // the transcript's file name without .jsonl (the engine's session id)
  id: string
  title: string
  project: string
  // the last wrap-up recap
  recap?: string
  // the last wrap-up question, while nothing was typed after it
  ask?: string
  prs: string[]
  mtimeMs: number
}

export type Pr = { repo: string; number: number; title: string; url: string; isDraft: boolean }

export type View = {
  // this conversation
  here: { id: string; title: string; project: string; goal?: string; recap?: string }
  talks: Talk[]
  prs: Pr[]
  items: Item[]
  // ms since the epoch of the last refresh; null before the first
  at: number | null
  // why a source could not be read (gh missing, ...)
  notes: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'puppy-todo': { view: View }
  }
}
