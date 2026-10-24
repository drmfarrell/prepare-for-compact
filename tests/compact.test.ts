import { test, expect } from 'claude-code/testing'

const usage = {
  input_tokens: 1,
  output_tokens: 1,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}
const messages = [{ role: 'user' as const, text: 'work so far', toolUses: [] }]
const summary = [{ role: 'user' as const, text: 'the summary', toolUses: [] }]

test('an automatic compaction writes the handoff note first', async ($, on) => {
  const written: { path: string; text: string }[] = []
  let instructions: string | undefined

  on('session.root', () => ({ value: '/repo' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: ' M hooks/register.ts\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('model.fork', () => ({ value: { isAnswered: true, text: '## Where things stand\nDone.', usage } }))
  on('fs.write', ($, e) => {
    written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('session.compact', ($, e) => {
    instructions = e.instructions
    return { messages: summary }
  })

  await $.session.compact({ trigger: 'auto', messages, instructions: 'keep the plan' })

  expect(written).toHaveLength(1)
  expect(written[0]?.path).toBe('/repo/.claude/HANDOFF.md')
  expect(written[0]?.text).toContain('Where things stand')
  expect(instructions).toStartWith('keep the plan')
  expect(instructions).toContain('.claude/HANDOFF.md')
})

test('a fork with no reply leaves the compaction as asked', async ($, on) => {
  let instructions: string | undefined

  on('session.root', () => ({ value: '/repo' }))
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }))
  on('session.compact', ($, e) => {
    instructions = e.instructions
    return { messages: summary }
  })

  await $.session.compact({ trigger: 'auto', messages, instructions: 'keep the plan' })

  expect(instructions).toBe('keep the plan')
})

const usageWith = (tokens: number) => ({
  value: { startedAt: 0, context: { tokens, window: 1_000_000 }, rateLimits: [] },
})

test('an idle compaction is held while the skill runs first', async ($, on) => {
  const submitted: string[] = []
  let isCompacted = false

  on('session.surfaces', () => ({ value: ['terminal' as const] }))
  on('session.usage', () => usageWith(300_000))
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('session.compact', () => {
    isCompacted = true
    return { messages: summary }
  })

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const result = await $.session.compact({ trigger: 'manual', messages })

  expect(result.skip).toContain('saving session state first')
  expect(isCompacted).toBe(false)
  expect(submitted).toHaveLength(1)
  expect(submitted[0]).toContain('Claude Code, not the user')
  expect(submitted[0]).toContain('Make no commits')
})

test('an idle compaction may commit once the user opts in', { options: { commitWhenAway: true } }, async ($, on) => {
  const submitted: string[] = []

  on('session.surfaces', () => ({ value: ['terminal' as const] }))
  on('session.usage', () => usageWith(300_000))
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('session.compact', () => ({ messages: summary }))

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.session.compact({ trigger: 'manual', messages })

  expect(submitted).toHaveLength(1)
  expect(submitted[0]).toContain('Claude Code, not the user')
  expect(submitted[0]?.includes('Make no commits')).toBe(false)
})

test('a typed /compact is held with the prompt that says the user asked', async ($, on) => {
  const submitted: string[] = []

  on('session.surfaces', () => ({ value: ['terminal' as const] }))
  on('session.usage', () => usageWith(300_000))
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('session.compact', () => ({ messages: summary }))
  // The engine's /compact, held open: its compaction runs while it does.
  let finish: ((result: { text: string }) => void) | undefined
  on('command.run', () => new Promise(resolve => { finish = resolve }))

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const running = $.command.run({
    command: 'compact',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  for (let tick = 0; finish === undefined && tick < 100; tick++) await Promise.resolve()
  const result = await $.session.compact({ trigger: 'manual', messages })
  finish?.({ text: result.skip ?? 'Compacted' })
  await running

  expect(finish).toBeDefined()
  expect(result.skip).toContain('saving session state first')
  expect(submitted).toHaveLength(1)
  expect(submitted[0]).toStartWith('The user asked to compact.')
  expect(submitted[0]?.includes('Make no commits')).toBe(false)
})

test('a compaction at the threshold is not held', async ($, on) => {
  let isCompacted = false

  on('session.surfaces', () => ({ value: ['terminal' as const] }))
  on('session.usage', () => usageWith(300_000))
  on('session.root', () => ({ value: '/repo' }))
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork' } }))
  on('session.compact', () => {
    isCompacted = true
    return { messages: summary }
  })

  await $.session.compact({ trigger: 'auto', messages })

  expect(isCompacted).toBe(true)
})
