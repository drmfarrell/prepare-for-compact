# prepare-for-compact

A Claude Code plugin that saves what a session knows before its context is
compacted.

Compaction keeps a summary and drops the detail: why an approach was rejected,
which numbers were measured and which assumed, what is half-done. The code is
already on disk; the reasoning is not. This plugin holds the compaction, has
Claude run the bundled `prepare-for-compact` skill in a turn of its own (commit
finished work, write `.claude/HANDOFF.md`), and starts the compaction when that
turn ends. The summary then tells the next session to read the note.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install prepare-for-compact --marketplace drmfarrell/prepare-for-compact
```

Answer `y` to add the marketplace, then choose a scope (the user scope runs it
in every session).

From a shell:

```
claude plugin install prepare-for-compact --marketplace drmfarrell/prepare-for-compact
```

In the desktop app, where `/plugin` does not run: click + next to the prompt
box, then Plugins, Add marketplace with `drmfarrell/prepare-for-compact`, then
Add plugin.

The plugin is a hooks module, which needs a recent Claude Code. It was built
and tested on 2.1.309.

If you already have the skill as a standalone copy in
`~/.claude/skills/prepare-for-compact`, remove it: the plugin brings its own.

## What happens on each kind of compaction

| Compaction | What the plugin does |
| --- | --- |
| You type `/compact` | Holds it. Claude runs the skill in full, commits included, and the compaction starts on its own when that turn ends. |
| Claude Code compacts an idle session on its own, before the prompt cache lapses | Holds it the same way, but tells Claude you may be away: it asks nothing, and commits nothing unless `commitWhenAway` is on. |
| Automatic, because the context is full | There is no room for a turn, so a model call without tools writes `.claude/HANDOFF.md` from the conversation and `git status`, `log` and `diff`. Nothing is committed. |

Also:

- A compaction is held only with at least 100,000 tokens of context free;
  with less, the note is written the automatic way.
- If the skill has already run since your last prompt, the compaction goes
  straight through.
- If the preparation turn is interrupted or fails, nothing is compacted.
- `claude -p` sessions and subagent compactions are never held.

Claude Code labels its idle compaction the same as a typed `/compact`, so the
plugin tells them apart by whether `/compact` was actually typed.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `commitWhenAway` | off | Lets the skill commit finished work during an idle compaction, while you may be away. |

You are asked for it when you install; change it later in `/config`. An
unattended commit goes through only if your permission mode lets Claude run
`git commit` without asking; otherwise the turn waits for your approval, and
the compaction with it.

## Good to know

- The note goes to `.claude/HANDOFF.md` at the project root and replaces the
  previous one. Commit it, ignore it or leave it, as suits the project.
- The skill can also be run by hand: ask Claude to "prepare for compact".
- Tested with `claude plugin test .`. A live idle compaction and the
  automatic-path note have been exercised in tests but not yet seen in a live
  session, and the 100,000-token threshold is a judgement, not a measurement.

## Development

```
claude plugin validate .
claude plugin test .
```

## License

MIT. See [LICENSE](LICENSE).
