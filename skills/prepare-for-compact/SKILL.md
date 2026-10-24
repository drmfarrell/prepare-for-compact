---
name: prepare-for-compact
description: Persist session state to disk before the context window is compacted or cleared. Use when the user says "prepare for compact", "we're about to compact", "flush state", "checkpoint", or before any deliberate context reset. Also use proactively when a long session is approaching its context limit and work is at a natural stopping point.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Prepare for compaction

Context is about to be discarded. Your job is to make sure nothing that
matters lives only in your head.

Do **not** run `/compact` yourself. Prepare the workspace and stop.

## What actually survives, and what is actually at risk

The code already survives — every edit went to disk through a tool call.
There is no unsaved code in your memory, and you should not invent any.

What dies with the context is the **reasoning**:

- why an approach was rejected, and what its failure looked like
- which numbers were *measured* versus assumed or remembered
- what the user decided, and what they explicitly declined
- which claims are backed by a test and which are still guesses
- what you were part-way through, and what you were about to do next

A future session can re-read the code. It cannot re-derive why the obvious
approach was wrong without paying the same cost again. Persist the
reasoning, not a narrative of what you did.

## Order of work

### 1. Orient before writing anything

```
git status --short
git log --oneline -15
git diff --stat
```

Establish three things:

- **What is yours.** A dirty tree may contain the user's own in-flight
  work from before the session. Identify it and leave it completely alone.
- **What is already committed.** Committed work with a good message is
  already persisted; do not duplicate it into a notes file.
- **What is uncommitted and yours.** This is the at-risk set.

### 2. Commit working state — this is the highest-value step

A commit message is the best durable memory available to you: immutable,
timestamped, and permanently attached to the diff it explains. A future
session reading `git log` gets the reasoning in exactly the place it will
be looking.

Commit anything that is complete and verified. Write the message to
explain **why**, including:

- the non-obvious decision and what was rejected
- any bug whose cause would not be evident from the diff
- measured values, with what they were checked against

Stage explicitly by path. Never `git add -A` or `git commit -a` during
compaction prep — that is how the user's unrelated work gets swept into
your commit.

If work is genuinely half-finished, **do not rush it to completion** to
make it committable. Leave it uncommitted and describe its exact state in
the handoff note. A hastily finished function is worse than an honestly
described unfinished one.

### 3. Write the handoff note

Default to `.claude/HANDOFF.md` in the project root, overwriting the
previous one — it describes *now*, not history. History belongs in git.

Before writing to any other file, **read it first**. Files like
`TODO.md`, `NOTES.md` and `CLAUDE.md` are often curated with a stated
editorial policy, and appending session chatter to them is a regression.
If an existing file has a clear purpose that your content does not match,
use the handoff note instead.

Keep it short and high-signal. Cover:

- **Where things stand** — the last thing completed, in one or two lines.
- **Next step** — the single most concrete next action, specific enough to
  start without re-deriving anything.
- **In flight** — anything uncommitted, mid-edit, or deliberately left
  broken, and exactly what state it is in.
- **Verified vs assumed** — which claims have a passing test behind them,
  and which are still unchecked. Name the test commands that matter.
- **Rejected approaches** — what was tried, why it failed. This is the
  most expensive knowledge to regenerate and the easiest to lose.
- **Open decisions for the user** — anything awaiting their judgement, so
  it is not silently dropped or, worse, silently decided.

Write for a competent stranger, because that is what you will be. Avoid
"as discussed" and "the fix we talked about"; name the file, the function,
the number.

### 4. Update CLAUDE.md only for durable invariants

Add to `CLAUDE.md` only when the session established something a *future
contributor* must not break: a build invariant, an architectural
constraint, a trap that already bit someone. Session status is not that,
and neither is a feature list.

If nothing durable was established, change nothing. Padding `CLAUDE.md`
makes it less likely to be read.

### 5. Report

List what you wrote, in a few lines: commits made (with hashes), files
written, and anything you deliberately left alone. Then stop.

## Do not

- **Do not run `/compact`.** Prepare only.
- **Do not commit work that is not yours.** Check `git status` against
  what you actually touched.
- **Do not start new work.** No refactors, no "while I'm here" cleanups,
  no fixing an unrelated bug you noticed. Preparation only.
- **Do not fabricate completeness.** If tests were not run, say so. If a
  number was estimated rather than measured, say so. An inaccurate handoff
  is worse than none, because the next session will trust it.
- **Do not dump a transcript.** Nobody needs the sequence of events. They
  need the current state and the conclusions.
