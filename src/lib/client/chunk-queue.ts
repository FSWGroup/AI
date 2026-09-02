"use client";

/**
 * IndexedDB-backed queue for recording chunks awaiting upload.
 * Keeps memory flat during long recordings and survives brief offline
 * periods and page refreshes. Never holds the whole recording in memory.
 */

// Kept from before the Talent Scout rename on purpose. This names an IndexedDB
// database in the candidate's own browser; renaming it would strand chunks
// queued by anyone mid-assessment at the moment of deploy.
const DB_NAME = "fsw-workfit-recording";
const STORE = "chunks";

export interface QueuedChunk {
  key: string; // `${sessionId}:${sequence}`
  sessionId: string;
  sequence: number;
  blob: Blob;
  startedAt: string;
  endedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueChunk(chunk: QueuedChunk): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(chunk);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function peekChunks(limit = 5): Promise<QueuedChunk[]> {
  const db = await openDb();
  const chunks = await new Promise<QueuedChunk[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll(undefined, limit);
    req.onsuccess = () => resolve(req.result as QueuedChunk[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return chunks.sort((a, b) => a.sequence - b.sequence);
}

export async function removeChunk(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function pendingChunkCount(): Promise<number> {
  const db = await openDb();
  const count = await new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return count;
}
