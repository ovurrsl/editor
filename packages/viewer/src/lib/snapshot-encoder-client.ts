/**
 * Snapshot Encoder Client
 *
 * Manages zero-copy Web Worker dispatch for snapshot encoding,
 * with transparent fallback to in-process execution when Worker or OffscreenCanvas is unavailable.
 */

import {
  type SnapshotEncodeRequest,
  type SnapshotEncodeResponse,
  processSnapshotRequest,
} from './snapshot-encoder.worker'

export type { SnapshotEncodeRequest, SnapshotEncodeResponse }

export class SnapshotEncoderClient {
  private worker: Worker | null = null
  private pendingRequests = new Map<
    string,
    {
      resolve: (res: SnapshotEncodeResponse) => void
      reject: (err: any) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private isWorkerSupported: boolean | null = null

  private getWorker(): Worker | null {
    if (this.isWorkerSupported === false) return null
    if (this.worker) return this.worker

    if (typeof Worker === 'undefined') {
      this.isWorkerSupported = false
      return null
    }

    try {
      this.worker = new Worker(new URL('./snapshot-encoder.worker.ts', import.meta.url), {
        type: 'module',
      })

      this.worker.addEventListener('message', (event: MessageEvent<SnapshotEncodeResponse>) => {
        const response = event.data
        const pending = this.pendingRequests.get(response.id)
        if (pending) {
          clearTimeout(pending.timer)
          this.pendingRequests.delete(response.id)
          if (response.success) {
            pending.resolve(response)
          } else {
            pending.reject(new Error(response.error || 'Snapshot encoding failed in worker'))
          }
        }
      })

      this.worker.addEventListener('error', (error) => {
        console.warn('[SnapshotEncoderClient] Worker error, rejecting pending requests:', error)
        for (const [, pending] of this.pendingRequests.entries()) {
          clearTimeout(pending.timer)
          pending.reject(error)
        }
        this.pendingRequests.clear()
      })

      this.isWorkerSupported = true
      return this.worker
    } catch (err) {
      console.warn(
        '[SnapshotEncoderClient] Failed to initialize Web Worker, using in-process fallback:',
        err,
      )
      this.isWorkerSupported = false
      this.worker = null
      return null
    }
  }

  public async encode(request: SnapshotEncodeRequest): Promise<SnapshotEncodeResponse> {
    const worker = this.getWorker()

    if (!worker) {
      // In-process fallback execution
      return processSnapshotRequest(request)
    }

    return new Promise<SnapshotEncodeResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(request.id)
        reject(new Error(`Snapshot encoding timed out for request ${request.id}`))
      }, 30000)

      this.pendingRequests.set(request.id, { resolve, reject, timer })

      try {
        // Zero-copy transfer of pixels.buffer
        worker.postMessage(request, [request.pixels.buffer])
      } catch (postErr) {
        clearTimeout(timer)
        this.pendingRequests.delete(request.id)
        console.warn(
          '[SnapshotEncoderClient] postMessage transfer failed, falling back to in-process:',
          postErr,
        )
        processSnapshotRequest(request).then(resolve, reject)
      }
    })
  }

  public dispose(): void {
    if (this.worker) {
      for (const [, pending] of this.pendingRequests.entries()) {
        clearTimeout(pending.timer)
        pending.reject(new Error('Snapshot encoder disposed'))
      }
      this.pendingRequests.clear()
      this.worker.terminate()
      this.worker = null
    }
  }
}

let clientInstance: SnapshotEncoderClient | null = null

export function getSnapshotEncoderClient(): SnapshotEncoderClient {
  if (!clientInstance) {
    clientInstance = new SnapshotEncoderClient()
  }
  return clientInstance
}

export async function encodeSnapshot(
  request: SnapshotEncodeRequest,
): Promise<SnapshotEncodeResponse> {
  return getSnapshotEncoderClient().encode(request)
}

export function disposeSnapshotEncoder(): void {
  if (clientInstance) {
    clientInstance.dispose()
    clientInstance = null
  }
}
