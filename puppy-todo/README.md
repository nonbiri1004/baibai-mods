# puppy-todo

a to-do pane beside the chat, shared by every conversation. when you come back to a conversation it tells you what this one was doing, what other conversations asked you, and what is left.

```
•ᴥ• 9 to-do · 1 asked you                 refresh
╭─────────────────────────────────────────────╮
│ asked you                         1 waiting │
│ games chat · 3h                             │
│   make the office prototype first?          │
╰─────────────────────────────────────────────╯
╭─────────────────────────────────────────────╮
│ my-app                                    3 │
│ last: the list works; offline sync is next. │
│ [add a to-do…]                              │
│                                             │
│ this conversation                           │
│  ○  test offline sync                  2h ⋯ │
│  ↗  merge the notes PR             #78 1d ⋯ │
│ ▸ other conversations                     1 │
╰─────────────────────────────────────────────╯
╭─────────────────────────────────────────────╮
│ other projects                            6 │
│ ▸ games                                   2 │
│ ▸ website                                 4 │
╰─────────────────────────────────────────────╯
▸ done 8
▸ tidy up: 32 of 80 conversations have nothing open
looked at 14:05
```

it looks like the other puppy mods: one card per part ([style](../STYLE.md)). it shows little at first and opens on a press:

- **asked you** comes first, and only when another conversation is waiting for your answer. the first three show; `▸ more` shows the rest.
- **this project** is open: its last recap, the add field, this conversation's to-dos, then `▸ other conversations` of the same project.
- **other projects** are one line each with a count. press a name to see its to-dos.
- a row is `○` (tick it) or `↗` (a PR: GitHub ticks it), the words, a short link (`#78`) and how old it is. `⋯` shows the whole text, which conversation wrote it, and `delete`.
- done items and the conversation list stay folded at the bottom.

it opens by itself when a session starts. `/todo` opens it again; `/todo <text>` adds a to-do for this conversation.

## what you do

- **add**: the field at the top of the list, or `/todo <text>`.
- **tick** ○ when it's done. tick ☑ under `done` to open it again.
- **⋯** on a row: the whole text, where it came from, and `delete` for something you won't do. on the desktop `⋯` shows when the pointer is on the row.
- **▸** opens a fold: more questions, the project's other conversations, another project, done, tidy up.
- **tidy up**: when the sidebar gets long, unfold the last row. it lists every open conversation with what is still open in it and its last recap, so you can archive from the sidebar without opening each one.

that's all. everything else happens by itself.

## what happens by itself

- **asked you**: the last question another conversation asked in its wrap-up box, while you haven't typed anything after it. questions fade after two days.
- **PR items** (↗) have no tick: they turn done when GitHub says the PR merged, and show ✕ under `done` if it closed without merging.
- **claude keeps the list**: with the mod installed, claude has `todo_add`, `todo_done` and `todo_list`, and a line in your `CLAUDE.md` asks it to add what is left at the end of a conversation and tick what it finished.
- **one thing, one item**: `todo_add` refuses the same words (or the same PR) already open in that project, and says so when a new item looks a lot like an open one.
- **this conversation first**: the to-dos written here, by this session or an earlier one of the same conversation, come before the rest.

## the shared list

one small json file per item in `~/.claude/todo/items/`, so conversations writing at the same time don't overwrite each other's items. the file name is the id.

beside it, three files the panes share so twenty open conversations do the work of one. they are only a cache: delete them any time.

- `talks.json`: what each recent transcript said. one pane at a time reads transcripts (it holds `scan.lease`), and every pane uses what it wrote.
- `prs.json`: what GitHub last said about each PR. an open PR is asked again after 5 minutes, a merged or closed one only when you press refresh.

```json
{
  "schemaVersion": 2,
  "id": "20261025-1210-m8p2",
  "text": "call the vet about the shots",
  "project": "home",
  "kind": "todo",
  "status": "open",
  "session": { "id": "…", "title": "notes app", "cwd": "…" },
  "by": "claude",
  "createdAt": "2026-10-25T04:10:00.000Z",
  "completion": { "mode": "declared" }
}
```

- ticking sets `status: "done"`, `doneAt`, and `declaration` (who said it: `person` for a tick in the pane; `recordedBy: "claude"` when you said it in a conversation).
- a PR item has `"source": { "type": "github-pr", "host": "github.com", "repo": "you/my-app", "number": 78 }` and `"completion": { "mode": "source", "condition": "merged" }`. github decides; `status` in the file is ignored. a plain `link` decides nothing.
- delete sets `deletedAt` and `deletedBy`. the file stays; the item is never shown again.
- files from older versions still work. unknown fields are kept.

without the mod (codex, a script, you), write a file in this shape.

a line for your `CLAUDE.md`:

> before ending a conversation, add what is still left with `todo_add` (pass `pr` when a PR merging finishes it), or write a file to `~/.claude/todo/items/`. tick with `todo_done` only when the person said it is done (`by: person`) or you did it and checked (`by: claude`).

## limits

- a mod sees only its own session. other conversations are read from their transcript files, whose format is the app's and may change.
- "nothing open found" in tidy-up is a hint, not a promise: a question asked in plain text, or work never written down, isn't seen. archiving stays in the app's sidebar, since it also removes the conversation's worktree.
- a conversation is matched to its transcript by the time of its last activity, else by its title. forks with the same title, when the time doesn't tell them apart, may show each other's last turn.
- "asked you" only knows questions from the app's wrap-up box.
- the app's conversation list is read in pages of 150, 80 or 40; the pane says when it shows only the newest ones.
- the list lives on this computer; a second computer has its own `~/.claude/todo/`.
- PR items need the `gh` cli, signed in.

## install

```
/plugin install puppy-todo --marketplace nonbiri1004/puppy-mods
```

## license

MIT
