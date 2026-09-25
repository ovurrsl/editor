'use client'

import { ArrowLeft, Check, ChevronDown, Pencil, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/primitives/dropdown-menu'
import { cn } from '@/lib/utils'
import { updateProjectName } from '../lib/projects/actions'
import { useProjectStore } from '../lib/projects/store'
import { NewProjectDialog } from './new-project-dialog'

/**
 * Editor project menu (feat/roof icon-rail menu + sidebar-header title):
 * shows the project name, renames it inline, switches to another project,
 * goes back to the community hub or creates a new project.
 */
export function ProjectDropdown({ projectId }: { projectId: string }) {
  const router = useRouter()
  const projects = useProjectStore((state) => state.projects)
  const activeProject = useProjectStore((state) =>
    state.activeProject?.id === projectId ? state.activeProject : null,
  )
  const setActiveProject = useProjectStore((state) => state.setActiveProject)
  const fetchProjects = useProjectStore((state) => state.fetchProjects)

  const [isNewProjectDialogOpen, setIsNewProjectDialogOpen] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  useEffect(() => {
    if (isRenaming) inputRef.current?.select()
  }, [isRenaming])

  const startRename = () => {
    setDraftName(activeProject?.name ?? '')
    setIsRenaming(true)
  }

  const commitRename = async () => {
    setIsRenaming(false)
    const name = draftName.trim()
    if (!name || name === activeProject?.name) return
    const result = await updateProjectName(projectId, name)
    if (result.success) {
      await Promise.all([setActiveProject(projectId), fetchProjects()])
    }
  }

  if (isRenaming) {
    return (
      <input
        className="h-9 w-[220px] rounded-lg border border-border bg-background px-3 text-sm shadow-lg outline-none focus:ring-2 focus:ring-primary"
        onBlur={commitRename}
        onChange={(e) => setDraftName(e.target.value)}
        ref={inputRef}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setIsRenaming(false)
        }}
        value={draftName}
      />
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background/95 px-3 text-sm shadow-lg backdrop-blur-md transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none"
            type="button"
          >
            <span className="max-w-[180px] truncate font-medium">
              {activeProject?.name ?? 'Project'}
            </span>
            <ChevronDown className="h-3 w-3 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[280px]">
          <DropdownMenuItem className="cursor-pointer" onClick={startRename}>
            <Pencil className="mr-2 h-4 w-4" />
            <span>Rename project</span>
          </DropdownMenuItem>
          <DropdownMenuItem className="cursor-pointer" onClick={() => router.push('/')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            <span>Back to community</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {projects.length > 0 ? (
            <div className="max-h-[300px] overflow-y-auto">
              {projects.map((project) => (
                <DropdownMenuItem
                  className={cn(
                    'cursor-pointer text-sm',
                    project.id === projectId && 'cursor-default bg-accent',
                  )}
                  key={project.id}
                  onClick={() => {
                    if (project.id !== projectId) router.push(`/project/${project.id}`)
                  }}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <div className="flex-1 truncate font-medium">{project.name}</div>
                    {project.id === projectId && (
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                    )}
                  </div>
                </DropdownMenuItem>
              ))}
            </div>
          ) : (
            <div className="px-2 py-3 text-center text-muted-foreground text-sm">
              No projects yet
            </div>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="cursor-pointer"
            onClick={() => setIsNewProjectDialogOpen(true)}
          >
            <Plus className="mr-2 h-4 w-4" />
            <span>New project</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NewProjectDialog
        onOpenChange={setIsNewProjectDialogOpen}
        onSuccess={(newProjectId) => router.push(`/project/${newProjectId}`)}
        open={isNewProjectDialogOpen}
      />
    </>
  )
}
