import type { Register } from 'claude-code'

// The skill run ahead of a compaction: the standalone one or a plugin's copy.
const SKILL = /(^|:)prepare-for-compact$/
const HANDOFF = '.claude/HANDOFF.md'

// Free tokens a preparation turn needs; below it the fork writes the note.
const ROOM = 100_000

const PREP_STEPS =
  'Before it runs, invoke the prepare-for-compact skill and follow it to the ' +
  'end. Do not run /compact yourself: the compaction starts on its own when ' +
  'this turn ends.'

const PREP_PROMPT = {
  typed: `The user asked to compact. ${PREP_STEPS}`,
  // Claude Code compacts an idle session on its own, before its cache lapses.
  unattended:
    'Claude Code, not the user, started a compaction of this session, and ' +
    `the user may be away. ${PREP_STEPS} Nobody is here to answer questions: ` +
    'put anything that needs the user under open decisions in the handoff ' +
    'note instead of asking.',
}

// Commits while the user may be away are theirs to opt into (commitWhenAway).
const NO_COMMITS =
  "Make no commits: skip the skill's commit step, and describe the " +
  'uncommitted work under in flight in the handoff note instead.'

// An automatic compaction fires with the window nearly full, too late for a
// turn with tools, so a tool-less fork writes the handoff note alone: the
// skill's step 3, without the commits.
const FORK_PROMPT = `The context window is full and is about to be compacted automatically. You cannot call tools now. Write the handoff note the prepare-for-compact skill describes, for a competent stranger who will resume this work with none of this conversation. Reply with the note's Markdown content only: no preamble, no code fence.

Cover, briefly and concretely (name the file, the function, the number, the command):
- Where things stand: the last thing completed, in one or two lines.
- Next step: the single most concrete next action, specific enough to start without re-deriving anything.
- In flight: anything uncommitted, mid-edit or deliberately left broken, and exactly what state it is in. Nothing was committed for this compaction.
- Verified vs assumed: which claims have a passing test or a measurement behind them, and which are still unchecked. Name the test commands that matter.
- Rejected approaches: what was tried, and why it failed.
- Open decisions for the user: anything awaiting their judgement.

Do not fabricate completeness: if tests were not run, say so; if a number was estimated rather than measured, say so. Do not narrate the session. Every rule you are already under (CLAUDE.md, memory) applies, including what may appear in a file that could be tracked.

The repository as it stands now:`

const HEADER =
  '<!-- Written by the prepare-for-compact mod ahead of an automatic ' +
  'compaction, from a tool-less fork: nothing was committed. -->\n\n'

const GIT = [
  ['status', '--short'],
  ['log', '--oneline', '-15'],
  ['diff', '--stat'],
]

const clip = (text: string, max = 4000) =>
  text.length > max ? `${text.slice(0, max)}\n… (cut)` : text

const unfence = (text: string) =>
  text.trim().replace(/^```[\w-]*\n([\s\S]*?)\n```$/, '$1')

export const register: Register = (on, options) => {
  // Set in session.start, whose `$` keeps timers going past its dispatch.
  let compactSoon: ((instructions?: string) => void) | undefined
  // The skill has run since the last prompt, so what is on disk is current.
  let isPrepared = false
  // A /compact held back until the preparation turn ends.
  let pending: { instructions?: string } | undefined
  // The compaction this mod started is under way.
  let isOurs = false
  // The user's own /compact is running.
  let isCompactTyped = false

  const unattended =
    options.commitWhenAway === true ? PREP_PROMPT.unattended : `${PREP_PROMPT.unattended} ${NO_COMMITS}`

  on('session.start', ($, e, next) => {
    compactSoon = instructions => {
      let tries = 0
      const attempt = () => {
        isOurs = true
        $.session.compact({ instructions }).then(
          result => {
            isOurs = false
            if (result.skip !== undefined)
              $.ui.toast(`${$.plugin.name}: compaction skipped: ${result.skip}`)
          },
          () => {
            // It rejects while a turn still runs; try again once idle.
            isOurs = false
            if (++tries < 20) $.clock.after(500, attempt)
            else $.ui.toast(`${$.plugin.name}: the compaction did not start; run /compact again`)
          },
        )
      }
      $.clock.after(250, attempt)
    }
    return next(e)
  })

  // A prompt is new work; a slash command (`/compact` itself) is not.
  on('prompt.submit', ($, e, next) => {
    if (e.command === undefined) isPrepared = false
    return next(e)
  }).catch(($, e, next) => next(e))

  // A typed /compact raises no prompt.submit, only command.run, and its
  // compaction runs inside it: the command prints the compaction's result.
  on('command.run', { command: 'compact' }, async ($, e, next) => {
    isCompactTyped = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    try {
      return await next(e)
    } finally {
      isCompactTyped = false
    }
  }).catch(($, e, next) => next(e))

  on('skill.prompt', ($, e, next) => {
    if (SKILL.test(e.skill)) isPrepared = true
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    if (e.reason !== 'answer') isPrepared = false
    if (pending !== undefined) {
      const { instructions } = pending
      pending = undefined
      if (e.reason === 'answer') compactSoon?.(instructions)
      else $.ui.toast(`${$.plugin.name}: preparation ended (${e.reason}); nothing was compacted`)
    }
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined || e.trigger === 'precompute') return next(e)

    // `auto` is the threshold or a prompt too long: no room for a turn. Every
    // other compaction, the idle one included, gets the skill run in full.
    // A session nothing draws (`claude -p`) never runs a turn of a plugin's.
    const canPrepare = async () => {
      if ((await $.session.surfaces()).length === 0) return false
      const { context } = await $.session.usage()
      return context.tokens === undefined || context.window - context.tokens >= ROOM
    }
    if (!isPrepared && !isOurs && e.trigger !== 'auto' && compactSoon && (await canPrepare())) {
      pending = { instructions: e.instructions }
      $.prompt.submit({ text: isCompactTyped ? PREP_PROMPT.typed : unattended }).catch(() => {
        pending = undefined
      })
      return { skip: `${$.plugin.name}: saving session state first; the compaction runs when that turn ends` }
    }

    const root = await $.session.root()

    const writeHandoff = async () => {
      try {
        const git = await Promise.all(
          GIT.map(async args => {
            const ran = await $.process.run(['git', ...args], { cwd: root, timeoutMs: 10_000 })
            const out = ran.exitCode === 0 ? ran.stdout.trim() || '(nothing)' : `(failed: ${ran.stderr.trim()})`
            return `$ git ${args.join(' ')}\n${clip(out)}`
          }),
        )
        const reply = await $.model.fork({ prompt: `${FORK_PROMPT}\n\n${git.join('\n\n')}` })
        if (!reply.isAnswered || reply.text.trim() === '') {
          $.ui.log(`${$.plugin.name}: no handoff note (${reply.isAnswered ? 'empty reply' : reply.reason})`)
          return false
        }
        await $.fs.write(`${root}/${HANDOFF}`, `${HEADER}${unfence(reply.text)}\n`)
        $.ui.toast(`${$.plugin.name}: wrote ${HANDOFF}`)
        return true
      } catch (error) {
        $.ui.log(`${$.plugin.name}: no handoff note (${String(error)})`)
        return false
      }
    }

    // Prepared, or our own compaction after the preparation turn: the skill
    // has already written what it meant to; otherwise the fork writes it now.
    const isFresh =
      isPrepared || isOurs
        ? isPrepared && (await $.fs.exists(`${root}/${HANDOFF}`))
        : await writeHandoff()
    if (!isFresh) return next(e)

    const note =
      `A handoff note was written to ${HANDOFF} just before this compaction. ` +
      'Say so in the summary, and tell the next session to read it before resuming work.'
    return next({ ...e, instructions: e.instructions ? `${e.instructions}\n\n${note}` : note })
  }).catch(($, e, next) => next(e))
}
