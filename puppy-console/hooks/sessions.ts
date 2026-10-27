// The conversations card (FORMAT.md, "conversations"). Each conversation writes one small file
// about itself when a turn starts and ends; the pane reads them all. Pure functions, so the
// tests need no engine.
import type { Conversation, ConversationState } from '../types'

// Under the home folder, on this computer only: what you typed and the recaps never go into
// the status folder, which may be synced. The pane shows a conversation for this long after its
// last turn, so an archived one leaves by itself.
export const SESSIONS = '.claude/console/sessions'
export const KEEP_MS = 3 * 24 * 3_600_000
// A "running" file older than this was left by a conversation that closed mid-turn.
export const RUNNING_MS = 30 * 60_000

const STATES: readonly ConversationState[] = ['running', 'waiting', 'done', 'error']

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : undefined)

// A user message the person typed, not one that only carries tool results.
type Message = { role: 'user' | 'assistant'; text: string; toolUses: { tool: string; input: Record<string, unknown> }[]; toolResults?: unknown[] }
const isPrompt = (m: Message) => m.role === 'user' && !m.toolResults?.length && plain(m.text) !== ''

// What the person typed, without the <tag>…</tag> blocks the app wraps around it
// (system reminders, command caveats, pasted content).
export function plain(text: string): string {
  return text.replace(/<([a-z][\w-]*)[^>]*>[\s\S]*?<\/\1>/gi, '').trim()
}

export function oneLine(text: string, max: number): string {
  const line = text.split('\n').map(l => l.trim()).find(l => l !== '') ?? ''
  return [...line].length > max ? `${[...line].slice(0, max - 1).join('')}…` : line
}

// The conversation's name: the first thing the person typed in it.
export function nameOf(messages: Message[]): string {
  const first = messages.find(isPrompt)
  return first ? oneLine(plain(first.text), 60) : 'new conversation'
}

// The desktop app's wrap_up tool: its recap says what is now true, its ask what waits on you.
export const isWrapUp = (tool: string) => /(^|__)wrap_up$/.test(tool)
export function wrapOf(input: Record<string, unknown>): { recap: string; ask: string | null } | null {
  const recap = str(input.recap)
  return recap ? { recap: oneLine(recap, 300), ask: str(input.ask) ? oneLine(str(input.ask)!, 120) : null } : null
}

// Only what the card needs is checked; anything else in the file is left alone.
export function parseConversation(text: string): Conversation {
  const v: unknown = JSON.parse(text)
  if (!isObject(v) || v.format !== 'session-status' || v.version !== 1) throw new Error('not a session-status file')
  if (typeof v.id !== 'string' || !v.id) throw new Error('no "id"')
  if (typeof v.updated !== 'string' || Number.isNaN(Date.parse(v.updated))) throw new Error('"updated" is not a time')
  if (!STATES.includes(v.state as ConversationState)) throw new Error('bad "state"')
  return {
    format: 'session-status',
    version: 1,
    id: v.id,
    updated: v.updated,
    state: v.state as ConversationState,
    title: str(v.title) ?? v.id,
    project: str(v.project),
    host: str(v.host),
    recap: str(v.recap) ?? '',
    ask: str(v.ask) ?? null,
  }
}

// How the card shows a conversation now: a "running" file nobody finished is done.
export function shownState(c: Conversation, now: number): ConversationState {
  return c.state === 'running' && now - Date.parse(c.updated) > RUNNING_MS ? 'done' : c.state
}

// The last few days only; the ones waiting for you first, then errors, running, done; newest first.
const ORDER: Record<ConversationState, number> = { waiting: 0, error: 1, running: 2, done: 3 }
export function recent(list: Conversation[], now: number): Conversation[] {
  return list
    .filter(c => now - Date.parse(c.updated) <= KEEP_MS)
    .sort((a, b) => ORDER[shownState(a, now)] - ORDER[shownState(b, now)] || Date.parse(b.updated) - Date.parse(a.updated))
}

// "/Users/me/dev/puppy-mods" → "puppy-mods"
export const folderName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
