import { type AnyNodeId, GuideNode, ScanNode, useScene } from '@pascal-app/core'
import { useEditor, useUploadStore } from '@pascal-app/editor'
import {
  type AssetType,
  confirmAssetUpload,
  createAssetUploadUrl,
} from '@/features/community/lib/assets/actions'

/**
 * Upload a file directly to Supabase Storage via signed URL with progress tracking.
 * Runs entirely outside React — survives component unmounts.
 */
export function uploadAssetWithProgress(
  projectId: string,
  levelId: string,
  file: File,
  assetType: AssetType,
) {
  useUploadStore.getState().startUpload(levelId, assetType, file.name)

  doUpload(projectId, levelId, file, assetType).catch(() => {
    // errors are already recorded in the store by doUpload
  })
}

async function doUpload(projectId: string, levelId: string, file: File, assetType: AssetType) {
  const store = () => useUploadStore.getState()
  const contentType = file.type || 'application/octet-stream'

  const urlResult = await createAssetUploadUrl(projectId, file.name, contentType, assetType)
  if (!urlResult.success) {
    store().setError(levelId, urlResult.error)
    return
  }

  store().setStatus(levelId, 'uploading')

  try {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          useUploadStore.getState().setProgress(levelId, Math.round((e.loaded / e.total) * 100))
        }
      })
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve()
        } else {
          reject(new Error(`Upload failed: HTTP ${xhr.status}`))
        }
      })
      xhr.addEventListener('error', () => reject(new Error('Network error during upload')))
      xhr.addEventListener('abort', () => reject(new Error('Upload aborted')))

      xhr.open('PUT', urlResult.signedUrl)
      xhr.setRequestHeader('Content-Type', contentType)
      xhr.send(file)
    })
  } catch (err) {
    store().setError(levelId, err instanceof Error ? err.message : 'Upload failed')
    return
  }

  store().setStatus(levelId, 'confirming')

  const confirmResult = await confirmAssetUpload(
    projectId,
    urlResult.assetId,
    urlResult.storageKey,
    file.name,
    file.type || null,
    assetType,
  )
  if (!confirmResult.success) {
    store().setError(levelId, confirmResult.error)
    return
  }

  const Schema = assetType === 'scan' ? ScanNode : GuideNode
  const node = Schema.parse({
    url: confirmResult.url,
    name: file.name,
    parentId: levelId,
  })
  useScene.getState().createNode(node, levelId as AnyNodeId)
  useEditor.getState().setSelectedReferenceId(node.id)

  store().setResult(levelId, confirmResult.url)

  setTimeout(() => {
    useUploadStore.getState().clearUpload(levelId)
  }, 1500)
}
