// Any JSON value (what a status file can hold).
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

// One status file, as FORMAT.md describes it (format "pipeline-status", version 1).
export type State = 'running' | 'idle' | 'waiting' | 'error'

export type WaitingItem = { id: string; text: string; since?: string }

export type Status = {
  format: 'pipeline-status'
  version: 1
  pipeline: string
  title?: string
  host?: string
  updated: string
  stale_after_sec?: number
  state: State
  headline: string
  progress?: { done: number; total: number | null; unit?: string } | null
  waiting?: WaitingItem[]
  last_output?: { label: string; at?: string; path?: string } | null
  next?: string | null
  detail?: { [key: string]: Json } | null
}

// detail of pipeline "music" (lofi-puppy tools/status_export.py)
export type MusicBatch = {
  name: string
  strip?: string
  est_usable?: number | null
  target_usable?: number | null
  generated?: number | null
  ok?: number | null
  needs_listen?: number | null
  rejected?: number | null
  errors?: number | null
  avg_gen_sec?: number | null
  status_tail?: string[]
}
export type MusicDetail = {
  comfy?: { up: boolean; running: number | null; pending: number | null }
  generating?: boolean | null
  batches?: MusicBatch[]
}

// detail of pipeline "ai-video" (video-pipeline)
export type Stage = 'plan' | 'clips' | 'voice' | 'compose' | 'final' | 'done'
export type VideoJob = { job: string; stage: Stage; spend_usd: number; cap_usd: number; updated?: string; next?: string }
export type VideoDetail = { spend_usd?: number; cap_usd?: number; jobs?: VideoJob[] }

// A file in the folder that is not a card, and why.
export type Problem = { file: string; reason: string }

export type Snapshot = {
  dir: string
  cards: Status[]
  problems: Problem[]
  // the folder itself could not be read (missing, not set)
  dirError: string | null
  loadedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'puppy-pipelines': { snapshot: Snapshot | null }
  }
}
