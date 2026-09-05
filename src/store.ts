// What IndexedDB is used for: remembering the choices that should outlive a
// restart. The folder is the reason it exists at all — directory handles cannot
// be stringified, so localStorage is out. One key, no schema.
//
// A 'language' key also sits in this store on anyone who ran 0.3.1 to 0.5.0.
// Nothing reads it any more and it is a few bytes, so it is left where it is
// rather than shipping a migration to delete it.
const DB_NAME = 'blab';
const STORE = 'handles';
const ROOT_KEY = 'root';

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
        // Every call opens its own connection, so every call has to give it
        // back. close() does not cut the transaction short — it marks the
        // connection to shut once the transaction finishes — so it is safe to
        // ask for here rather than tracking the transaction separately.
        req.onsuccess = () => {
          db.close();
          resolve(req.result);
        };
        req.onerror = () => {
          db.close();
          reject(req.error);
        };
      }),
  );
}

export function rememberRoot(handle: FileSystemDirectoryHandle): Promise<unknown> {
  return tx('readwrite', (s) => s.put(handle, ROOT_KEY));
}

/** For a remembered folder that turns out never to be usable again. */
export function forgetRoot(): Promise<unknown> {
  return tx('readwrite', (s) => s.delete(ROOT_KEY));
}

export function recallRoot(): Promise<FileSystemDirectoryHandle | undefined> {
  return tx('readonly', (s) => s.get(ROOT_KEY));
}
