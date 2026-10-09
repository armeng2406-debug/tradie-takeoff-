import { DEFAULT_CALCULATION_INPUTS } from './core.js';
import { SAMPLE_HEIGHT, SAMPLE_WIDTH } from './samplePlan.js';

const DB_NAME = 'tradie-takeoff-material-calculator';
const DB_VERSION = 1;
const LAST_WORKSPACE_KEY = 'tradie-takeoff:material-calculator:last';
const WORKSPACE_PREFIX = 'tradie-takeoff:material-calculator:workspace:';

export function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

export function workspaceKey(state) {
  const projectId = state?.project?.id || slugify(state?.project?.name);
  const documentId = state?.document?.id || 'no-document';
  return `${WORKSPACE_PREFIX}${projectId}:${documentId}`;
}

export function createDefaultState() {
  return {
    schemaVersion: 1,
    project: { id: 'oak-street-renovation', name: 'Oak Street Renovation' },
    document: { id: 'sample-plumbing-v1', name: 'Oak Street · Plumbing plans', kind: 'sample', fileKey: null, pageCount: 2 },
    currentPage: 1,
    pageDimensions: {
      1: { width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT },
      2: { width: SAMPLE_WIDTH, height: SAMPLE_HEIGHT },
    },
    marks: [],
    runs: [],
    areas: [],
    calibrations: {},
    calculationInputs: { ...DEFAULT_CALCULATION_INPUTS },
    manualMaterials: [],
    takeoff: [],
    lastAppliedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export class WorkspaceStore {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
  }

  save(state) {
    if (!this.storage?.setItem) throw new Error('Local browser storage is not available.');
    const key = workspaceKey(state);
    const snapshot = { ...state, updatedAt: new Date().toISOString() };
    try {
      this.storage.setItem(key, JSON.stringify(snapshot));
      this.storage.setItem(LAST_WORKSPACE_KEY, key);
    } catch (error) {
      throw new Error(error?.message || 'Could not save this workspace.');
    }
    return { key, state: snapshot };
  }

  load(stateOrKey) {
    if (!this.storage?.getItem) return null;
    const key = typeof stateOrKey === 'string' ? stateOrKey : workspaceKey(stateOrKey);
    try {
      const raw = this.storage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.schemaVersion !== 1) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  loadLast() {
    if (!this.storage?.getItem) return null;
    try {
      const key = this.storage.getItem(LAST_WORKSPACE_KEY);
      return key ? this.load(key) : null;
    } catch {
      return null;
    }
  }

  getLastKey() {
    try { return this.storage?.getItem?.(LAST_WORKSPACE_KEY) ?? null; } catch { return null; }
  }
}

function openDocumentDb(factory = globalThis.indexedDB) {
  if (!factory?.open) return Promise.reject(new Error('Browser file storage is unavailable.'));
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open browser file storage.'));
    request.onblocked = () => reject(new Error('Browser file storage is blocked by another tab.'));
  });
}

export async function saveDocumentBytes(key, bytes, factory = globalThis.indexedDB) {
  const db = await openDocumentDb(factory);
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('documents', 'readwrite');
      transaction.objectStore('documents').put({ key, bytes });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Could not save the PDF in this browser.'));
      transaction.onabort = () => reject(transaction.error || new Error('PDF save was cancelled.'));
    });
  } finally {
    db.close();
  }
}

export async function loadDocumentBytes(key, factory = globalThis.indexedDB) {
  const db = await openDocumentDb(factory);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('documents', 'readonly');
      const request = transaction.objectStore('documents').get(key);
      request.onsuccess = () => resolve(request.result?.bytes ?? null);
      request.onerror = () => reject(request.error || new Error('Could not reopen the saved PDF.'));
    });
  } finally {
    db.close();
  }
}
