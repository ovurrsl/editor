/**
 * Navigation helpers for project-based routing
 */

export function getEditorUrl(projectId: string): string {
  return `/project/${projectId}`
}

export function getViewerUrl(projectId: string): string {
  return `/viewer/${projectId}`
}

export function getHomeUrl(): string {
  return '/'
}
