# pipeline-cards

a pane beside the chat with one card per production pipeline: what it is doing now, what waits for you, the last thing it made, and what comes next.

the mod only reads. each pipeline writes one small json file into a folder you pick, and every file there becomes a card. a new pipeline needs no change to the mod: it only starts writing its file. the format is in [FORMAT.md](FORMAT.md).

```
┌ music ─────────────────────── running · 1m ago · studio-mac ┐
│ 05_autumn · 42/70 usable                                    │
│ [the puppy at work]  ■■■■■■□■■■■■■■■□■■■…                   │
│ waiting for you                                             │
│ · hear 3 songs in 05_autumn: #7, #12, #31                   │
│ next: making songs                                          │
└─────────────────────────────────────────────────────────────┘
```

- cards that wait for you come first, then errors, then running, then idle.
- a pipeline that promised to write every few minutes (`stale_after_sec`) and went quiet gets a "quiet" mark, so a sleeping computer doesn't look like it is still working.
- a file in the folder that isn't a status file is named at the bottom with the reason, never dropped without a word.
- the folder can be a synced one (google drive, dropbox), so a pipeline on another computer gets a card too.
- the desktop app draws a small picture per card (the music card has the puppy and one square per song; the ai-video card groups jobs by review gate). the terminal shows the same as text.

## install

in a claude code session in your terminal:

```
/plugin install pipeline-cards --marketplace nonbiri1004/baibai-mods
```

answer `y` to add the marketplace, then pick a scope. set **status folder** to the folder your pipelines write into (`~` is your home folder). you can change it later in `/config`.

## commands

| command | what it does |
| --- | --- |
| `/pipelines` | opens the pane. it reads the folder again every minute; `r` reads it now |

## develop

```
claude plugin validate pipeline-cards
claude plugin test pipeline-cards
```

## license

MIT
