// The token is rendered by Django; fetching a fresh one also supports multiple tabs.
export const csrfHeaders = async (signal?: AbortSignal): Promise<Record<string, string>> => {
  const response = await fetch('/api/auth/csrf', { credentials: 'same-origin', signal })
  if (!response.ok) throw new Error('CSRF token unavailable')
  const result = await response.json() as { csrfToken: string }
  return { 'Content-Type': 'application/json', 'X-CSRFToken': result.csrfToken }
}
