/**
 * Proposal Panel
 *
 * Studio's view of a persisted `_feltdb.Proposal` against the connected
 * repository: is this proposal still fresh, and is the repository in a state
 * where it can be applied.
 *
 * The panel reads. It never writes to the repository, and the apply step is
 * always the developer's own `feltdb ai apply`.
 */

import React from 'react'
import type { Proposal, ProposalRepositoryComparison } from '../../../lib/proposal'
import { isProposalActionable, proposalRequiresApproval } from '../../../lib/proposal'
import type { RepositoryContext } from '../../../lib/repositoryContext'

interface ProposalPanelProps {
  proposal: Proposal
  comparison: ProposalRepositoryComparison | null
  repository: RepositoryContext | null
  busy?: string | null
  error?: string | null
  onPreview: () => void
  onOpenInIde: () => void
  onApprove: () => void
}

const FRESHNESS_LABEL = { matches: '✓ matches', stale: '⚠ stale', unknown: '· unknown' } as const

export const ProposalPanel: React.FC<ProposalPanelProps> = ({
  proposal,
  comparison,
  repository,
  busy,
  error,
  onPreview,
  onOpenInIde,
  onApprove,
}) => {
  const actionable = isProposalActionable(proposal)
  const repositoryLabel = comparison
    ? comparison.repository === 'clean' ? '✓ clean' : comparison.repository === 'modified' ? '⚠ working tree modified' : '· unknown'
    : '· not connected'

  return (
    <div className="proposal-panel">
      <div className="proposal-header">
        <h3>Proposal {proposal.proposal_id}</h3>
        <span className={`status-badge ${proposal.status.toLowerCase()}`}>{proposal.status}</span>
      </div>
      <p className="proposal-summary">{proposal.summary}</p>

      <div className="proposal-freshness">
        <div className="freshness-row"><span className="label">Contract</span><span>{comparison ? FRESHNESS_LABEL[comparison.contract] : '· not connected'}</span></div>
        <div className="freshness-row"><span className="label">Flow</span><span>{comparison ? FRESHNESS_LABEL[comparison.flow] : '· not connected'}</span></div>
        <div className="freshness-row"><span className="label">Repository</span><span>{repositoryLabel}</span></div>
      </div>

      {repository && (
        <div className="proposal-repository">
          <div><span className="label">Branch</span><code>{repository.repository.branch || 'unknown'}</code></div>
          <div><span className="label">Commit</span><code>{repository.repository.commit.slice(0, 7) || 'unknown'}</code></div>
        </div>
      )}

      {comparison?.conflicts.length ? (
        <div className="proposal-conflicts">
          <h4>Uncommitted changes conflict with the source plan</h4>
          <ul>{comparison.conflicts.map((path) => <li key={path}><code>{path}</code></li>)}</ul>
        </div>
      ) : null}

      {proposal.warnings?.length ? (
        <div className="proposal-warnings">
          <h4>Warnings</h4>
          <ul>{proposal.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div>
      ) : null}

      {proposal.source_plan?.length ? (
        <div className="proposal-source-plan">
          <h4>Source plan</h4>
          <ul>{proposal.source_plan.map((entry) => <li key={entry.path}><code>{entry.path}</code>{entry.reason ? ` — ${entry.reason}` : ''}</li>)}</ul>
        </div>
      ) : null}

      <div className="proposal-actions">
        <button type="button" onClick={onPreview} disabled={Boolean(busy)}>Preview</button>
        <button type="button" onClick={onOpenInIde} disabled={Boolean(busy) || !actionable}>Open in IDE</button>
        <button type="button" onClick={onApprove} disabled={Boolean(busy) || !proposalRequiresApproval(proposal)}>Approve</button>
      </div>

      {busy && <p className="proposal-status">{busy}</p>}
      {error && <p className="proposal-error">{error}</p>}

      {proposal.status === 'APPROVED' && (
        <div className="proposal-apply">
          <p>Approved. Apply from your repository:</p>
          <code>feltdb ai apply {proposal.proposal_id}</code>
        </div>
      )}
      {!actionable && <p className="proposal-status">This proposal is {proposal.status.toLowerCase()} and is no longer actionable.</p>}
    </div>
  )
}
