# why puppy-todo looks like this

the goal: open the pane and know in a few seconds what waits for you, with nothing to learn. this note keeps the reasons, so the next change starts from them.

## who it is for

one person, ten to twenty Claude Code conversations open at once, about fifteen projects. the pain is not "what is the next step of this task" (each conversation knows that). it is:

- which conversation is waiting for me?
- what did I promise, or ask for, that is still not done, across all of them?
- which PRs still need me to merge them?

## what others do (checked 2026-10-27)

| tool | the idea | where the data lives | how a thing gets done | what we take from it |
| --- | --- | --- | --- | --- |
| [Claude Code tasks](https://code.claude.com/docs/en/interactive-mode#task-list) | the agent's own checklist for one job; `CLAUDE_CODE_TASK_LIST_ID` shares it between sessions | `~/.claude/tasks/` | the agent updates it | show only a few items at first (ctrl+t shows five) |
| [Claude Code desktop](https://code.claude.com/docs/en/desktop) | the sidebar lists sessions; a notice when one finishes; auto-archive after a PR merges | the app | the app | don't copy what the app does (which session is running); add what it doesn't (what is still owed) |
| [Inbox](https://github.com/petekp/inbox) | a plugin that collects a session's questions, findings and PRs into one panel, with a status line above the prompt | plugin storage | answering, or the agent closing it | questions come first; every row has one obvious action |
| [Agentbox](https://www.everydev.ai/tools/agentbox) | every agent is an inbox row that comes back only when it finishes or gets stuck | its own app | you approve, reply, or snooze | only show what needs you |
| [Cursor agents window](https://cursor.com/docs/agent/agents-window) | all agents in a sidebar; group by status gives a "needs attention" section | the app | the agent | group by "does it need me", fold the rest |
| [Task Master](https://github.com/eyaltoledano/claude-task-master), [Beads](https://github.com/gastownhall/beads) | a task graph with priorities and blockers; `next` / `bd ready` picks the next task | `tasks.json`, `.beads/` | `set-status`, `bd close` | not taken: priorities and blockers cost more to keep than they give here |
| [Claude HUD](https://github.com/jarrodwatts/claude-hud) | a status line with context, tools and todo progress | reads the session | none (it only shows) | details stay hidden until asked for |

Codex (gpt-6-astra, with web search) did the same survey on its own; the table merges both.

## what we keep, and why

- **one list for every conversation.** the native tasks are for one job; here a promise lives on after its conversation stops.
- **"asked you".** the questions other conversations left in their wrap-up box, with the words, not just a dot. this is what tells you which conversation to open.
- **a PR decides its own item.** an item with `pr` turns done when GitHub says merged. `link` alone decides nothing. "the agent says it's done" and "it merged" stay apart.
- **who said it's done.** a tick in the pane is the person; `todo_done` records `by` and a note.
- **one json file per item.** many conversations write at once; one file each keeps them from overwriting each other.

## what we leave out, and why

- priorities, due dates, blockers, statuses beyond open/done: keeping them up is work, and nothing here needs them.
- skip / snooze (taken out on 10/25): a hidden item coming back by itself made people ask "why is this here again?".
- a color per project, a pink "old" mark (tried on 10/26): the brand is warm greys with one accent; seven days is not a deadline, and the list already shows the oldest first.
- a live "running / using Bash" line: the mod only sees its own session; guessing it for others means reading transcripts more often, which made the Mac hot once.

## how the pane shows little at first

1. the puppy line: how many to-dos, how many asked you, refresh.
2. **asked you**, only when something waits; three questions, `▸ more` for the rest. the one accent color is here.
3. **this project**, open: last recap, add field, this conversation's items, `▸ other conversations`.
4. **other projects**: one line each with a count; a press opens one.
5. `▸ done`, `▸ tidy up`, folded.

a row: `○` or `↗`, the words (cut, never wrapped), a short link, the age, `⋯`. `⋯` holds the whole text, where it came from, and delete. day to day you only add, tick, and open things.

## how Claude keeps it

- at the end of a conversation, `todo_add` what is still left: one short sentence, not every step, not ideas.
- `pr` only when merging that PR is exactly the end of it.
- `todo_add` refuses the same words or PR already open in the project, and warns when an item looks like an open one.
- `todo_done` only when the person said it is done, or Claude did it and checked.

## how we change it

- read [STYLE.md](../STYLE.md) first; a change ships only after its PR merges and `version` goes up.
- a big change gets a Codex review (read-only, given the diff, not Claude's reasons); every finding is checked by hand before it is fixed.
- try it before merging with `claude --plugin-dir .claude/worktrees/<name>/puppy-todo`.
