import { createImageUploadUrls, submitFeedback } from './actions'

/**
 * Upload the images straight to Supabase Storage through signed URLs, then
 * record the feedback. Keeps image bytes out of the server action body.
 */
export async function submitFeedbackWithImages(data: {
  message: string
  projectId?: string
  sceneGraph: unknown
  images: File[]
}): Promise<{ success: boolean; error?: string }> {
  let imagePaths: string[] = []

  if (data.images.length > 0) {
    const urls = await createImageUploadUrls(
      data.images.map((file) => ({ name: file.name, type: file.type })),
    )
    if (!urls.success) return { success: false, error: urls.error }

    const images = data.images.filter((file) => file.type.startsWith('image/'))
    const uploads = await Promise.all(
      urls.uploads.map(async (upload, index) => {
        const file = images[index]
        if (!file) return null
        const response = await fetch(upload.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        })
        return response.ok ? upload.path : null
      }),
    )
    imagePaths = uploads.filter((path): path is string => path !== null)
  }

  return submitFeedback({
    message: data.message,
    projectId: data.projectId ?? null,
    sceneGraph: data.sceneGraph,
    imagePaths,
  })
}
