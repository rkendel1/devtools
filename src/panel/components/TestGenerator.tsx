import { useState } from 'react'
import { generatePlaywrightTest, generateVerificationTest, exportTestAsFile } from '../../lib/testGeneration'
import type { InvestigationRecord } from '../../lib/types'
import '../styles/TestGenerator.css'

export function TestGenerator({ record }: { record: InvestigationRecord }) {
  const [showTest, setShowTest] = useState(false)
  const [testType, setTestType] = useState<'reproduction' | 'verification'>('reproduction')
  const [copied, setCopied] = useState(false)

  const test = testType === 'reproduction' ? generatePlaywrightTest(record) : generateVerificationTest(record)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(test.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    exportTestAsFile(test)
  }

  return (
    <div className="test-generator">
      <div className="test-generator-header">
        <h3>Generate Test from Failure</h3>
        <p className="meta">Turn this investigation into an executable Playwright test</p>
      </div>

      <div className="test-controls">
        <div className="test-type-selector">
          <label>
            <input
              type="radio"
              name="testType"
              value="reproduction"
              checked={testType === 'reproduction'}
              onChange={() => setTestType('reproduction')}
            />
            <span>Reproduction Test</span>
            <span className="hint">Reproduces the failure</span>
          </label>
          <label>
            <input
              type="radio"
              name="testType"
              value="verification"
              checked={testType === 'verification'}
              onChange={() => setTestType('verification')}
            />
            <span>Verification Test</span>
            <span className="hint">Verifies the fix works</span>
          </label>
        </div>

        <div className="test-actions">
          <button className="primary" onClick={() => setShowTest(!showTest)}>
            {showTest ? '▼' : '▶'} Show Test
          </button>
          <button onClick={handleCopy} disabled={!showTest}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <button onClick={handleDownload} disabled={!showTest}>
            Download
          </button>
        </div>
      </div>

      {showTest && (
        <div className="test-display">
          <div className="test-metadata">
            <span className="test-language">Playwright</span>
            <span className="test-type">{testType}</span>
            <span className="line-count">{test.code.split('\n').length} lines</span>
          </div>

          <pre className="test-code">
            <code>{test.code}</code>
          </pre>

          <div className="test-notes">
            <h4>Quick Setup</h4>
            <ol>
              <li>Replace the TODO comments with your actual user interactions</li>
              <li>Update selectors to match your app's DOM elements</li>
              <li>Replace `error|failed|invalid` regex with your actual error text</li>
              <li>Add setup/cleanup (login, navigate, etc.) if needed</li>
              <li>Run: <code>npx playwright test</code></li>
            </ol>

            <h4>Common Patterns</h4>
            <div className="patterns">
              <div className="pattern">
                <strong>Click Button</strong>
                <code>await page.getByRole("button", {{'{'}} name: /text/i {{'}'} }).click();</code>
              </div>
              <div className="pattern">
                <strong>Fill Input</strong>
                <code>await page.getByLabel("Label").fill("value");</code>
              </div>
              <div className="pattern">
                <strong>Wait for Element</strong>
                <code>await page.waitForSelector(".success-message");</code>
              </div>
              <div className="pattern">
                <strong>Check URL</strong>
                <code>await expect(page).toHaveURL("/success");</code>
              </div>
              <div className="pattern">
                <strong>Mock Response</strong>
                <code>await page.route("**/api/**", r =&#62; r.abort("failed"));</code>
              </div>
              <div className="pattern">
                <strong>Intercept Response</strong>
                <code>await page.route("**/api/**", r =&#62; r.fulfill({{'{'}} status: 500 {{'}'} }));</code>
              </div>
            </div>

            <h4>Investigation Context</h4>
            <div className="context">
              <div>
                <strong>Failed Request</strong>
                <code>{record.graph.request.method} {record.graph.request.url}</code>
              </div>
              <div>
                <strong>Status</strong>
                <code>{record.graph.request.status} {record.graph.response.statusText}</code>
              </div>
              {record.graph.initiator?.source && (
                <div>
                  <strong>Initiated From</strong>
                  <code>
                    {record.graph.initiator.source}:{record.graph.initiator.line ?? 1}
                  </code>
                </div>
              )}
              <div>
                <strong>Diagnosis</strong>
                <p>{record.result.diagnosis}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
