/**
 * Proposal Workspace Panel
 *
 * The Studio side of the proposal bridge. It reads a persisted
 * `_feltdb.Proposal`, asks the connected repository for context, and shows
 * whether the proposal is still generated against what the developer has.
 *
 * DevTools holds no proposal of its own: the proposal is read from FeltDB on
 * demand, and approval is delegated back to FeltDB through `onApprove`. The
 * bridge itself has no write path to `_feltdb.Proposal` or the repository.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { PROPOSAL_COLLECTION, isProposal, type Proposal, type ProposalReadiness } from '../../lib/proposal'
import { ProposalBridgeClient, isProposalContextStale, type BridgeConnection, type ProposalContextSnapshot } from '../../lib/proposalBridge'
import { ProposalPanel } from './components/ProposalPanel'

interface ProposalWorkspacePanelProps {
  connection: BridgeConnection
  proposalId: string
  /** FeltDB owns approval. Studio asks; it does not write the proposal itself. */
  onApprove?: (proposal: Proposal) => Promise<void>
}

export const ProposalWorkspacePanel: React.FC<ProposalWorkspacePanelProps> = ({ connection, proposalId, onApprove }) => {
  const [client] = useState(() => new ProposalBridgeClient(connection, { clientId: 'devtools-studio' }))
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [snapshot, setSnapshot] = useState<ProposalContextSnapshot | null>(null)
  const [busy, setBusy] = useState<string | null>('Loading proposal…')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    client.start()
    let active = true
    void connection.get<unknown>(PROPOSAL_COLLECTION, proposalId).then((value) => {
      if (!active) return
      if (isProposal(value)) setProposal(value)
      else setError(`Proposal ${proposalId} was not found in FeltDB.`)
      setBusy(null)
    }).catch((cause: unknown) => { if (active) { setError(describe(cause)); setBusy(null) } })

    // A proposal that goes stale, rejected, or expired must be visible here too.
    const unsubscribe = connection.subscribe<Proposal>(PROPOSAL_COLLECTION, (event) => {
      if (event.type === 'deleted' || !isProposal(event.value) || event.value.proposal_id !== proposalId) return
      setProposal(event.value)
    })
    return () => { active = false; unsubscribe(); client.dispose() }
  }, [client, connection, proposalId])

  // The proposal is durable state; this snapshot is not. Always round-trip
  // rather than reusing a snapshot that may have aged past its TTL.
  const preview = useCallback(async () => {
    setBusy('Reading repository context…')
    setError(null)
    try { setSnapshot(await client.getProposalContext(proposalId)) }
    catch (cause) { setError(describe(cause)) }
    finally { setBusy(null) }
  }, [client, proposalId])

  const openInIde = useCallback(async () => {
    setBusy('Sending proposal context to the connected IDE…')
    setError(null)
    try {
      // Binding first is what keeps the IDE session tied to this proposal.
      await client.bindProposal(proposalId)
      const opened = await client.openInIde(proposalId)
      setSnapshot(await client.getProposalContext(proposalId))
      setBusy(`Opened in IDE with ${opened.relevantFiles.length} relevant files.`)
    } catch (cause) { setError(describe(cause)); setBusy(null) }
  }, [client, proposalId])

  const approve = useCallback(async () => {
    if (!proposal || !onApprove) return
    setBusy('Approving…')
    setError(null)
    try {
      await onApprove(proposal)
      setSnapshot(await client.getProposalContext(proposalId))
    }
    catch (cause) { setError(describe(cause)) }
    finally { setBusy(null) }
  }, [client, onApprove, proposal, proposalId])

  if (!proposal) return <div className="proposal-panel">{error ?? busy ?? 'No proposal selected.'}</div>

  const readiness: ProposalReadiness | null = snapshot && !isProposalContextStale(snapshot) ? snapshot.readiness : null

  return (
    <ProposalPanel
      proposal={proposal}
      readiness={readiness}
      busy={busy}
      error={error}
      onPreview={() => void preview()}
      onOpenInIde={() => void openInIde()}
      onApprove={() => void approve()}
    />
  )
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
