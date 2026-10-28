# puppy-console

a pane beside the chat. the first card is your conversations: which ones wait for you, where each stands, and what it asks. then one card per production pipeline: what it is doing now, what waits for you, the last thing it made, and what comes next.

the pipeline cards only read. each pipeline writes one small json file into a folder you pick, and every file there becomes a card. a new pipeline needs no change to the mod: it only starts writing its file. the format is in [FORMAT.md](FORMAT.md).

```
┌ music ─────────────────────── running · 1m ago · studio-mac ┐
│ 05_autumn · 42/70 usable                                    │
│ [the puppy at work]  ■■■■■■□■■■■■■■■□■■■…                   │
│ waiting for you                                             │
│ · hear 3 songs in 05_autumn: #7, #12, #31                   │
│ next: making songs                                          │
└─────────────────────────────────────────────────────────────┘
```

- the **conversations** card is always first. each conversation writes a short file about itself into `~/.claude/console/sessions/` when a turn starts and ends. that folder is on this computer only, never the status folder, so what you typed is not synced anywhere: its first line as a name, the folder it runs in, and the recap the desktop app's next-step box shows (in the terminal, the answer's first line). the ones that ask you something are shown with the question; the rest get one quiet line. a conversation leaves the card three days after its last turn. turn the writing off with **conversations** in `/config`.
- pipeline cards that wait for you come first, then errors, then running, then idle.
- a card with no update for more than three days folds into `▸ older N` at the bottom, unless it waits for you (waiting, error, or anything in its waiting list). press it to see them.
- press a card's name to fold it to one line (`▸`); press again to open it. the pane remembers, on this computer, across conversations and restarts, and so does the `older` group. a folded card that waits for you still says so on its line.
- the folder is read only while the pane is open: once when you open it, then every minute. a conversation without the pane reads nothing.
- when a card turns `waiting`, `error` or quiet, or a waiting card gets a new item, a short notice shows in the corner (once, not every minute), only while the pane is open. what changed while it was closed shows in the pane when you open it, without a notice. turn notices off with **notices** in `/config`.
- a pipeline that promised to write every few minutes (`stale_after_sec`) and went quiet gets a "quiet" mark, so a sleeping computer doesn't look like it is still working.
- a file in the folder that isn't a status file is named at the bottom with the reason, never dropped without a word.
- the folder can be a synced one (google drive, dropbox), so a pipeline on another computer gets a card too.
- the puppy is at the top, at its little laptop: typing while a conversation is running, sitting while one waits for you, asleep when nothing goes on. the desktop draws it moving; the terminal draws the same puppy in block characters, still (34 columns × 13 rows, from baibai-brand), only when the pane is at least 26 rows tall.
- the desktop app draws a small picture per card (the music card has the puppy and one square per song; the ai-video card groups jobs by review gate; an info-collector card, `collector-<profile>`, shows collected › new › scored › sent and what waits for your review in notion). the terminal shows the same as text.

## install

in a claude code session in your terminal:

```
/plugin install puppy-console --marketplace nonbiri1004/puppy-mods
```

answer `y` to add the marketplace, then pick a scope. set **status folder** to the folder your pipelines write into (`~` is your home folder). you can change it later in `/config`.

## commands

| command | what it does |
| --- | --- |
| `/console` | opens the pane and reads the folder. while the pane is open it reads again every minute; `r` reads it now |

## develop

```
claude plugin validate puppy-console
claude plugin test puppy-console
```

## license

MIT
