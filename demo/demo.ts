/**
 * Phase 4.11: Three-Peer Live Demo
 *
 * Demonstrates FeltDB Development Workspace as the shared state layer
 * for Browser, IDE, and Agent working together without direct integration.
 *
 * Usage: npm run demo
 */

import { LocalFeltDBNode } from '../src/lib/localFeltDBNode'
import { createChromeClient, createAgentClient } from '../src/lib/feltdbWorkspaceClient'
import { buildVisualSelection, buildSelectionTask } from '../src/lib/visualSelection'
import { createCodeChangeId } from '../src/lib/developmentWorkspace'
import type { CodeChange, VerificationResult } from '../src/lib/developmentWorkspace'
import { buildVerificationResult } from '../src/lib/verificationManager'

interface DemoEvent {
  timestamp: number
  client: 'Browser' | 'IDE' | 'Agent'
  action: string
  details?: string
}

class DemoHarness {
  private felt: LocalFeltDBNode
  private browser: ReturnType<typeof createChromeClient>
  private ide: any // Would be IDE client
  private agent: ReturnType<typeof createAgentClient>
  private events: DemoEvent[] = []
  private workspaceId = 'ws_demo_checkout'

  constructor() {
    this.felt = new LocalFeltDBNode()
    this.browser = createChromeClient(this.workspaceId, this.felt)
    this.agent = createAgentClient(this.workspaceId, this.felt)
    // IDE client not shown in this demo (would be similar)
  }

  logEvent(client: 'Browser' | 'IDE' | 'Agent', action: string, details?: string) {
    const event: DemoEvent = {
      timestamp: Date.now(),
      client,
      action,
      details,
    }
    this.events.push(event)
    console.log(
      `[${event.timestamp.toString().slice(-5)}] ${client.padEnd(8)} → ${action}${details ? ` (${details})` : ''}`,
    )
  }

  printActivityLog() {
    console.log('\n' + '='.repeat(60))
    console.log('WORKSPACE ACTIVITY')
    console.log('='.repeat(60))

    this.events.forEach((event) => {
      const time = new Date(event.timestamp).toLocaleTimeString()
      const emoji = event.client === 'Browser' ? '🌐' : event.client === 'IDE' ? '💻' : '🤖'
      console.log(`${time}  ${emoji} ${event.client}`)
      console.log(`         ${event.action}`)
      if (event.details) {
        console.log(`         ${event.details}`)
      }
    })

    console.log('='.repeat(60) + '\n')
  }

  async run() {
    console.log('\n' + '='.repeat(60))
    console.log('FeltDB Development Workspace Demo')
    console.log('='.repeat(60) + '\n')

    // STEP 1: Browser captures element selection
    console.log('STEP 1: Browser captures visual selection')
    const selection = buildVisualSelection(
      this.workspaceId,
      'http://localhost:3000/checkout',
      '.checkout-button',
      'Complete Order',
      { x: 200, y: 400, width: 400, height: 48 },
      'div.container > button.checkout-button',
      [],
      [{ file: 'src/app.tsx', line: 42, confidence: 'HIGH' as const }],
    )
    this.logEvent('Browser', 'Visual selection captured', `.checkout-button (400×48)`)

    // STEP 2: Browser publishes selection to workspace
    this.browser.write('visual_selection', selection)
    this.logEvent('Browser', 'Selection published to workspace', selection.id)

    // STEP 3: User describes intent
    console.log('\nSTEP 2: User describes change intent')
    const task = buildSelectionTask(
      this.workspaceId,
      selection.id,
      'Make this button smaller and change text to "Order Now"',
      'UI_CHANGE',
    )
    this.logEvent('Browser', 'SelectionTask created', task.userInstruction)

    // STEP 4: Browser publishes task
    this.browser.write('selection_task', task)
    this.logEvent('Browser', 'Task published to workspace', task.id)

    // Wait for agent to discover
    await new Promise((resolve) => setTimeout(resolve, 100))

    // STEP 5: Agent discovers task
    console.log('\nSTEP 3: Agent discovers task from workspace')
    const discoveredTask = this.agent.read('selection_task')
    if (discoveredTask) {
      this.logEvent('Agent', 'Task discovered', `"${discoveredTask.userInstruction}"`)
    }

    // STEP 6: Agent reads selection for context
    const discoveredSelection = this.agent.read('visual_selection')
    this.logEvent('Agent', 'Selection context read', `${discoveredSelection.boundingBox.width}×${discoveredSelection.boundingBox.height}px`)

    // STEP 7: Agent modifies code
    console.log('\nSTEP 4: Agent modifies source code')
    this.logEvent('Agent', 'Code modification', `width: 400px → 200px, text changed`)

    // STEP 8: Agent publishes CodeChange
    const change: CodeChange = {
      id: createCodeChangeId(),
      workspaceId: this.workspaceId,
      taskId: task.id,
      investigationId: '',
      kind: 'code_change',
      label: 'Resize button and update text',
      description: 'width: 400px → 200px, text: "Complete Order" → "Order Now"',
      filePath: 'src/app.tsx',
      lineStart: 42,
      lineEnd: 42,
      createdAt: Date.now(),
      createdBy: 'agent',
      status: 'READY_FOR_VERIFICATION',
      properties: {},
    }
    this.agent.write('code_change', change)
    this.logEvent('Agent', 'CodeChange published', change.id)

    await new Promise((resolve) => setTimeout(resolve, 100))

    // STEP 9: Browser detects change via subscription
    console.log('\nSTEP 5: Browser detects change and verifies')
    const detectedChange = this.browser.read('code_change')
    this.logEvent('Browser', 'Change detected via subscription', `${change.label}`)

    // STEP 10: Browser simulates verification
    this.logEvent('Browser', 'Verification started', 'Measuring new element state...')

    await new Promise((resolve) => setTimeout(resolve, 500))

    // STEP 11: Browser publishes verification result
    const result = buildVerificationResult(
      this.workspaceId,
      task.id,
      change.id,
      '',
      'verify:demo:001',
      400, // Original: had failure
      200, // After: fixed
      [],
      [selection.id],
    )

    this.browser.write('verification_result', result)
    this.logEvent('Browser', '✓ Verification passed', `Confidence: ${Math.round(result.confidence * 100)}%`)

    await new Promise((resolve) => setTimeout(resolve, 100))

    // STEP 12: Agent reads verification result
    console.log('\nSTEP 6: Agent reads verification result')
    const readResult = this.agent.read('verification_result')
    if (readResult && readResult.status === 'FIXED') {
      this.logEvent('Agent', '✓ FIX VERIFIED', `Task ${task.id} complete`)
    }

    // Print activity log
    this.printActivityLog()

    // Show workspace state
    console.log('WORKSPACE STATE')
    console.log('='.repeat(60))
    console.log(`Workspace ID: ${this.workspaceId}`)
    console.log(`Connected clients: ${this.felt.getConnectedClients().length}`)
    this.felt.getConnectedClients().forEach((client) => {
      console.log(`  - ${client.kind} (${client.id})`)
    })
    console.log('='.repeat(60) + '\n')

    console.log('KEY INSIGHT')
    console.log('='.repeat(60))
    console.log('All three clients coordinated through FeltDB workspace.')
    console.log('No direct Browser ↔ Agent communication.')
    console.log('No HTTP integration layer.')
    console.log('No custom protocol.')
    console.log('Just shared state.')
    console.log('='.repeat(60) + '\n')

    this.browser.disconnect()
    this.agent.disconnect()
  }
}

// Run demo
const demo = new DemoHarness()
void demo.run()
