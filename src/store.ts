// What IndexedDB is used for: remembering the choices that should outlive a
// restart. The folder is the reason it exists at all — directory handles cannot
// be stringified, so localStorage is out. The transcription language rides
// along in the same store rather than opening a second way of remembering
// things. Two keys, no schema.
const DB_NAME = 'blab';
const STORE = 'handles';
const ROOT_KEY = 'root';
const LANGUAGE_KEY = 'language';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = run(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function rememberRoot(handle: FileSystemDirectoryHandle): Promise<unknown> {
  return tx('readwrite', (s) => s.put(handle, ROOT_KEY));
}

export function recallRoot(): Promise<FileSystemDirectoryHandle | undefined> {
  return tx('readonly', (s) => s.get(ROOT_KEY));
}

export function rememberLanguage(code: string): Promise<unknown> {
  return tx('readwrite', (s) => s.put(code, LANGUAGE_KEY));
}

export function recallLanguage(): Promise<string | undefined> {
  return tx('readonly', (s) => s.get(LANGUAGE_KEY));
}
