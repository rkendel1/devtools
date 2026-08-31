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
import type { FingerprintState, Proposal, ProposalReadiness } from '../../../lib/proposal'
import { isProposalActionable, proposalRequiresApproval } from '../../../lib/proposal'

interface ProposalPanelProps {
  proposal: Proposal
  /** The same canonical readiness result the CLI renders. */
  readiness: ProposalReadiness | null
  busy?: string | null
  error?: string | null
  onPreview: () => void
  onOpenInIde: () => void
  onApprove: () => void
}

const FRESHNESS_LABEL: Record<FingerprintState, string> = { current: '✓ matches', stale: '⚠ stale', unrecorded: '· not recorded' }

export const ProposalPanel: React.FC<ProposalPanelProps> = ({
  proposal,
  readiness,
  busy,
  error,
  onPreview,
  onOpenInIde,
  onApprove,
}) => {
  const actionable = isProposalActionable(proposal)
  const repositoryLabel = readiness
    ? readiness.repository.state === 'clean' ? '✓ clean' : readiness.repository.state === 'modified' ? '⚠ working tree modified' : '· unknown'
    : '· not connected'

  return (
    <div className="proposal-panel">
      <div className="proposal-header">
        <h3>Proposal {proposal.proposal_id}</h3>
        <span className={`status-badge ${proposal.status.toLowerCase()}`}>{proposal.status}</span>
      </div>
      <p className="proposal-summary">{proposal.summary}</p>

      <div className="proposal-freshness">
        <div className="freshness-row"><span className="label">Contract</span><span>{readiness ? FRESHNESS_LABEL[readiness.contract] : '· not connected'}</span></div>
        <div className="freshness-row"><span className="label">Flow</span><span>{readiness ? FRESHNESS_LABEL[readiness.flow] : '· not connected'}</span></div>
        <div className="freshness-row"><span className="label">Repository</span><span>{repositoryLabel}</span></div>
      </div>

      {readiness && (
        <div className="proposal-repository">
          <div><span className="label">Branch</span><code>{readiness.repository.branch || 'unknown'}</code></div>
          <div><span className="label">Commit</span><code>{readiness.repository.commit.slice(0, 7) || 'unknown'}</code></div>
          {readiness.commitEvidence.matches === false && (
            <div className="evidence"><span className="label">Proposal commit</span><code>{(readiness.commitEvidence.proposal ?? '').slice(0, 7)}</code> (evidence only)</div>
          )}
        </div>
      )}

      {readiness?.sourceConflicts.length ? (
        <div className="proposal-conflicts">
          <h4>⚠ Proposal conflict</h4>
          <ul>
            {readiness.sourceConflicts.map((conflict) => (
              <li key={conflict.path}><code>{conflict.path}</code> — {conflict.change === 'untracked' ? 'added locally' : conflict.change === 'deleted' ? 'deleted locally' : 'modified locally'}, proposal plans to {conflict.planned}</li>
            ))}
          </ul>
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

      {readiness?.blockers.length ? (
        <div className="proposal-blockers">
          <h4>Not ready to apply</h4>
          <ul>{readiness.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
        </div>
      ) : null}

      {busy && <p className="proposal-status">{busy}</p>}
      {error && <p className="proposal-error">{error}</p>}

      {proposal.status === 'APPROVED' && (
        <div className="proposal-apply">
          <p>{readiness?.ready === false ? 'Approved, but the repository is not ready. Resolve the items above, then apply:' : 'Approved. Apply from your repository:'}</p>
          <code>feltdb ai apply {proposal.proposal_id}</code>
        </div>
      )}
      {!actionable && <p className="proposal-status">This proposal is {proposal.status.toLowerCase()} and is no longer actionable.</p>}
    </div>
  )
}
