import type { InvestigationRecord, NetworkRequestSnapshot } from '../../lib/types'
import { formatInvestigationReport, formatJiraReport, formatJsonReport, formatMarkdownReport } from '../../lib/report'

export type ExportFormat = 'text' | 'markdown' | 'jira' | 'json'

export function formatRequest(request: NetworkRequestSnapshot): string {
  const url = request.url.length > 90 ? `${request.url.slice(0, 90)}…` : request.url
  return `${request.status} ${request.method} ${url}`
}

export function reportFor(record: InvestigationRecord, format: ExportFormat): string {
  if (format === 'json') return formatJsonReport(record)
  if (format === 'markdown') return formatMarkdownReport(record)
  if (format === 'jira') return formatJiraReport(record)
  return formatInvestigationReport(record)
}

export async function writeClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    textarea.remove()
    return copied
  }
}

export function download(name: string, contents: string, type = 'text/plain'): void {
  const href = URL.createObjectURL(new Blob([contents], { type }))
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(href)
}

export function downloadDataUrl(name: string, href: string): void {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = name
  anchor.click()
}
