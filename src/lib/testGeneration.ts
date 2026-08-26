import type { InvestigationRecord } from './types'

export interface GeneratedTest {
  name: string
  code: string
  language: 'playwright' | 'cypress' | 'puppeteer'
  type: 'reproduction' | 'verification'
}

export function generatePlaywrightTest(record: InvestigationRecord): GeneratedTest {
  const { graph, result } = record
  const testName = sanitizeTestName(result.diagnosis)
  const url = extractBaseUrl(graph.request.url)
  const mocks = extractNetworkMocks(graph)
  const sourceHint = graph.initiator?.source ? `// ${graph.initiator.source}:${graph.initiator.line ?? 1}` : ''

  const code = `test("${testName}", async ({ page }) => {
  ${sourceHint}

  // Setup
  await page.goto("${url}");

  ${mocks.setup}

  // Trigger the failure
  // TODO: Replace with actual user interaction
  // Common patterns:
  // - await page.getByRole("button", { name: /checkout/i }).click();
  // - await page.getByLabel("Search").fill("query");
  // - await page.getByTestId("submit").click();

  // Verify the failure occurs
  await expect(page.getByText(/error|failed|invalid/i)).toBeVisible();

  // TODO: Add specific assertions based on your failure
  // Examples:
  // - await expect(page).toHaveTitle(/error/i);
  // - await expect(page.locator(".error-message")).toContainText("...");
  // - await expect(page.getByRole("button")).toBeDisabled();
});`

  return { name: testName, code, language: 'playwright', type: 'reproduction' }
}

export function generateVerificationTest(record: InvestigationRecord): GeneratedTest {
  const { graph, result } = record
  const testName = `verify fix for: ${sanitizeTestName(result.diagnosis)}`
  const url = extractBaseUrl(graph.request.url)
  const mocks = extractNetworkMocks(graph)

  const code = `test("${testName}", async ({ page }) => {
  // Verify the fix resolves the original failure

  await page.goto("${url}");

  ${mocks.setup}

  // Perform the previously-failing action
  // TODO: Replace with actual user interaction from reproduction test
  // await page.getByRole("button", { name: /checkout/i }).click();

  // Verify success (not the error)
  // TODO: Replace with your success criteria
  // Examples:
  // - await expect(page.getByText(/success|completed/i)).toBeVisible();
  // - await expect(page).toHaveURL(/confirmation/);
  // - await expect(page.getByRole("button")).not.toBeDisabled();
});`

  return { name: testName, code, language: 'playwright', type: 'verification' }
}

export function generateTestFile(tests: GeneratedTest[]): string {
  const imports = `import { test, expect } from "@playwright/test";

// Generated test file from runtime investigation
// Each test reproduces an observed failure and verifies the fix
// TODO: Replace placeholder selectors and interactions with real ones`

  const testCodes = tests.map((t) => t.code).join('\n\n')

  return `${imports}

${testCodes}
`
}

export interface NetworkMockSetup {
  setup: string
  routes: Array<{ url: string; response: unknown }>
}

function extractNetworkMocks(graph: any): NetworkMockSetup {
  const routes: Array<{ url: string; response: unknown }> = []
  const mockLines: string[] = []

  if (graph.bundle?.responseBody) {
    try {
      const body = typeof graph.bundle.responseBody === 'string' ? JSON.parse(graph.bundle.responseBody) : graph.bundle.responseBody
      routes.push({ url: graph.request.url, response: body })
      mockLines.push(`// Mock the failed request`)
      mockLines.push(`await page.route("${graph.request.url}", route => {`)
      mockLines.push(`  route.abort("failed");`)
      mockLines.push(`});`)
    } catch {
      // Silent
    }
  }

  if (routes.length === 0) {
    mockLines.push(`// TODO: Add network mocks based on captured responses`)
    mockLines.push(`// await page.route("**/api/**", route => {`)
    mockLines.push(`//   route.abort("failed");`)
    mockLines.push(`// });`)
  }

  return {
    setup: mockLines.join('\n  '),
    routes,
  }
}

function extractBaseUrl(fullUrl: string): string {
  try {
    const url = new URL(fullUrl)
    return `${url.protocol}//${url.host}`
  } catch {
    return 'https://example.com'
  }
}

export function sanitizeTestName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 41)
}

export function exportTestAsFile(test: GeneratedTest, fileName?: string): void {
  const name = fileName || `${test.name}_${Date.now()}.test.ts`
  const blob = new Blob([test.code], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}
