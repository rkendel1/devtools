/**
 * Proposal bridge wiring for VS Code.
 *
 * Reuses the existing FeltDB workspace connection — the same pairing and
 * workspace state the IDE already uses for runtime investigations. There is no
 * second connection registry and no second Studio↔IDE integration.
 */

import * as vscode from 'vscode'
import { sendPromptToAgent } from './commands.js'
import { ProposalBridgeService } from './proposal-bridge-service.js'
import { RepositoryContextProvider } from './repository-context.js'
import type { FeltWorkspaceClient } from './workspace-client.js'
import { isProposalActionable, renderProposalStatus, renderSourcePlanConflicts, type Proposal } from '../../src/lib/proposal.js'
import { renderProposalAgentPrompt } from '../../src/lib/proposalContext.js'

export class ProposalBridge implements vscode.Disposable {
  private service: ProposalBridgeService | undefined
  private readonly output = vscode.window.createOutputChannel('FeltDB Proposals')

  constructor(private readonly client: FeltWorkspaceClient) {}

  /** Rebuild the bridge whenever the shared workspace connection changes. */
  refresh(): void {
    this.service?.stop()
    this.service = undefined
    const connection = this.client.workspaceConnection
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!connection || !root) return
    this.service = new ProposalBridgeService({
      connection,
      provider: new RepositoryContextProvider({ root }),
      onOpenInIde: async (context) => {
        this.output.appendLine(`Proposal ${context.proposalId}: ${context.relevantFiles.length} relevant files, ${context.repository.repository.dirty ? 'working tree modified' : 'working tree clean'}`)
        await sendPromptToAgent(renderProposalAgentPrompt(context))
      },
      onProposalChanged: (proposal) => this.announce(proposal),
      onSourcePlanDrift: (path, proposalId) => {
        this.output.appendLine(`Proposal ${proposalId}: read ${path}, which is outside the proposal source plan.`)
      },
    })
    this.service.start()
  }

  async showDiagnostic(proposalId?: string): Promise<void> {
    if (!this.service) return void vscode.window.showWarningMessage('Connect to a FeltDB development workspace and open a repository folder first.')
    const id = proposalId ?? await this.askForProposalId('Proposal repository status')
    if (!id) return
    try {
      const report = await this.service.diagnostic(id)
      this.output.appendLine(report)
      this.output.show(true)
    } catch (error) { void vscode.window.showErrorMessage(message(error)) }
  }

  async openProposal(proposalId?: string): Promise<void> {
    if (!this.service) return void vscode.window.showWarningMessage('Connect to a FeltDB development workspace and open a repository folder first.')
    const id = proposalId ?? await this.askForProposalId('Open proposal in IDE')
    if (!id) return
    try {
      // Binds the session, so later repository requests are evaluated against
      // this proposal rather than answering for the repository generally.
      const context = await this.service.proposalContext(id)
      await sendPromptToAgent(renderProposalAgentPrompt(context))
      this.output.appendLine(renderSourcePlanConflicts(context.readiness))
      if (context.readiness.sourceConflicts.length) {
        void vscode.window.showWarningMessage(`Proposal ${id} conflicts with ${context.readiness.sourceConflicts.length} locally modified file(s). Review before applying.`, 'Show')
          .then((choice) => { if (choice === 'Show') this.output.show(true) })
      }
      if (context.status !== 'APPROVED') {
        void vscode.window.showInformationMessage(`Proposal ${id} is ${context.status}. Review only — approval happens in Studio, and application is \`feltdb ai apply ${id}\`.`)
      }
    } catch (error) { void vscode.window.showErrorMessage(message(error)) }
  }

  private announce(proposal: Proposal): void {
    this.output.appendLine(renderProposalStatus(proposal))
    if (!isProposalActionable(proposal)) {
      void vscode.window.showWarningMessage(`Proposal ${proposal.proposal_id} is now ${proposal.status}. Stop working from its context.`)
    }
  }

  private async askForProposalId(title: string): Promise<string | undefined> {
    const active = this.service?.activeProposal?.proposal_id
    const entered = await vscode.window.showInputBox({ title, prompt: 'FeltDB proposal id', placeHolder: 'p_123', value: active ?? '', ignoreFocusOut: true })
    return entered?.trim() || undefined
  }

  dispose(): void {
    this.service?.stop()
    this.output.dispose()
  }
}

export function registerProposalCommands(bridge: ProposalBridge): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('feltdb.openProposal', (proposalId?: string) => bridge.openProposal(typeof proposalId === 'string' ? proposalId : undefined)),
    vscode.commands.registerCommand('feltdb.proposalStatus', (proposalId?: string) => bridge.showDiagnostic(typeof proposalId === 'string' ? proposalId : undefined)),
  ]
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
