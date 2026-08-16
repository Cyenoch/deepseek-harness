/**
 * The /btw side chat app: the current session's /btw exchanges (question from
 * `command/run` args, answer from `command/done` outcome) plus an input that
 * submits a new side question through the host command plane. Derivation is a
 * pure filter over the framework-hook nodes snapshot (useMemo, per the
 * reactive-read discipline).
 */
import { useMemo, useState } from 'react'
import type { CommandNode, ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { BtwAppProps, SidePanelLaunchCardProps } from './contract/slots.ts'
import { LaunchCard } from './LaunchCard.tsx'
import css from './SidePanelRoot.module.css'

/** The /btw launchpad card. */
export function BtwLaunchCard({ open, t }: SidePanelLaunchCardProps) {
  return (
    <LaunchCard
      icon={<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden><path d="M2 3h12v8H8l-3 3v-3H2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="none" /></svg>}
      title={t('btw.title')}
      description={t('btw.description')}
      onOpen={() => { open({ id: 'btw', title: t('btw.title') }) }}
    />
  )
}

/** Whether one conversation node is a settled-or-running /btw command row. */
function isBtwCommand(node: ConversationSnapshot['nodes'][number]): node is CommandNode {
  return node.kind === 'command' && node.name === 'btw'
}

/** One exchange row: the question, then the settled answer or its live state. */
function Exchange({ node, pendingLabel, failedLabel }: { node: CommandNode; pendingLabel: string; failedLabel: string }) {
  const question = node.args ?? ''
  const outcome = node.outcome
  return (
    <article className={css.exchange}>
      <div className={css.question}>{question}</div>
      {outcome === null
        ? <div className={css.answerPending}>{pendingLabel}</div>
        : outcome.kind === 'success' && outcome.text !== undefined
          ? <div className={css.answer}>{outcome.text}</div>
          : <div className={css.answerError} data-error>{outcome.text ?? failedLabel}</div>}
    </article>
  )
}

/** The app body: transcript + ask input; owns nothing beyond local input state. */
export function BtwApp({ useSession, sessionId, ask, t }: BtwAppProps) {
  // Select the snapshot-cached nodes array (stable between frames), then
  // filter in a derivation — never a fresh array inside the selector.
  const nodes = useSession(s => s.nodes)
  // The maybe-hook yields undefined while no session is current; the
  // derivation treats that as no exchanges.
  const exchanges = useMemo(() => (nodes ?? []).filter(isBtwCommand), [nodes])

  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  if (sessionId === undefined) {
    return <div className={css.empty}>{t('btw.noSession')}</div>
  }

  const submit = async (): Promise<void> => {
    const question = draft.trim()
    if (question === '' || busy) return
    setBusy(true)
    setError(false)
    try {
      await ask(sessionId, question)
      setDraft('')
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.btwRoot}>
      <div className={css.transcript}>
        {exchanges.length === 0
          ? <div className={css.empty}>{t('btw.empty')}</div>
          : exchanges.map(node => (
            <Exchange key={String(node.commandId)} node={node} pendingLabel={t('btw.pending')} failedLabel={t('btw.failed')} />
          ))}
      </div>
      <div className={css.askRow}>
        <input
          className={css.askInput}
          value={draft}
          placeholder={t('btw.input.placeholder')}
          onChange={(event) => { setDraft(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) void submit()
          }}
        />
        <button type="button" className={css.askSubmit} disabled={busy || draft.trim() === ''} onClick={() => { void submit() }}>
          {busy ? t('btw.pending') : t('btw.input.submit')}
        </button>
      </div>
      {error && <div className={css.answerError} data-error>{t('btw.failed')}</div>}
    </div>
  )
}
