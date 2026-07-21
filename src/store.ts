// The only thing IndexedDB is used for: remembering which folder the user
// picked. Directory handles cannot be stringified, so localStorage is out.
// One key, one value, no schema.
const DB_NAME = 'blab';
const STORE = 'handles';
const KEY = 'root';

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
  return tx('readwrite', (s) => s.put(handle, KEY));
}

export function recallRoot(): Promise<FileSystemDirectoryHandle | undefined> {
  return tx('readonly', (s) => s.get(KEY));
}
