/**
 * Counterfactual Panel: UI for running causal experiments
 *
 * Shows:
 * - List of available mutations (currency, latency, status, etc.)
 * - Current experiment status
 * - Results of past experiments
 * - Isolated causal variables
 */

import React, { useState } from 'react'
import type { ReplayRun, ReplayFixture, OutcomeSignature } from '../lib/replayContract'
import type { Mutation } from '../lib/replayExperiment'
import { useCounterfactual } from '../hooks/useCounterfactual'
import { formatExperimentStatus } from '../lib/replayCounterfactual'
import '../styles/CounterfactualPanel.css'

interface CounterfactualPanelProps {
  run: ReplayRun
  fixture: ReplayFixture
  originalOutcome: OutcomeSignature
  onExperimentComplete?: (result: any) => void
}

export const CounterfactualPanel: React.FC<CounterfactualPanelProps> = ({
  run,
  fixture,
  originalOutcome,
  onExperimentComplete,
}) => {
  const counterfactual = useCounterfactual()
  const [selectedMutation, setSelectedMutation] = useState<Mutation | null>(null)
  const [expanded, setExpanded] = useState(false)

  const suggestedMutations: Mutation[] = [
    {
      type: 'variable',
      target: 'currency',
      originalValue: fixture.variables?.currency || null,
      newValue: 'USD',
      description: 'Set currency to USD',
    },
    {
      type: 'variable',
      target: 'quantity',
      originalValue: fixture.variables?.quantity || 1,
      newValue: 2,
      description: 'Increase quantity to 2',
    },
    {
      type: 'network_response',
      target: 'network:0:status',
      originalValue: 422,
      newValue: 200,
      description: 'Mock successful response (200)',
    },
    {
      type: 'timing',
      target: 'timing:0',
      originalValue: 100,
      newValue: 5000,
      description: 'Add 5s network delay',
    },
  ]

  const handleRunExperiment = async (mutation: Mutation) => {
    const result = await counterfactual.runExperiment(run, fixture, originalOutcome, mutation)
    if (result && onExperimentComplete) {
      onExperimentComplete(result)
    }
  }

  return (
    <div className="counterfactual-panel">
      <div className="counterfactual-header">
        <span className="counterfactual-title">Causal Experiments</span>
        <button
          className="counterfactual-toggle"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? 'Collapse experiments' : 'Expand experiments'}
        >
          {expanded ? '▼' : '▶'}
        </button>
      </div>

      {expanded && (
        <div className="counterfactual-content">
          <div className="mutations-list">
            {suggestedMutations.map((mutation, idx) => (
              <div key={idx} className="mutation-item">
                <button
                  className="mutation-button"
                  onClick={() => handleRunExperiment(mutation)}
                  disabled={counterfactual.loading}
                >
                  {counterfactual.loading && selectedMutation === mutation ? '⏳ Running...' : '▶'}
                  {mutation.description}
                </button>
              </div>
            ))}
          </div>

          {counterfactual.error && (
            <div className="experiment-error">{counterfactual.error}</div>
          )}

          {counterfactual.results.length > 0 && (
            <div className="results-list">
              <h4>Experiment Results</h4>
              {counterfactual.results.map((result, idx) => {
                const status = formatExperimentStatus(result.status)
                return (
                  <div key={idx} className="result-item">
                    <span className="result-icon" style={{ color: status.color }}>
                      {status.icon}
                    </span>
                    <div className="result-content">
                      <div className="result-text">
                        <strong>{result.isolatedVariable || 'Unknown'}</strong>
                        {': '}
                        {result.reasoning}
                      </div>
                      <div className="result-confidence">
                        {Math.round(result.confidence * 100)}% confidence
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
