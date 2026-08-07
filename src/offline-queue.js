// ── Fila offline com IndexedDB ────────────────────────────────
// Armazena CTOs cadastradas sem internet e sincroniza quando voltar

const DB_NAME    = 'cto-finder-offline'
const DB_VERSION = 1
const STORE      = 'pending-ctos'

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE, { keyPath: 'localId', autoIncrement: true })
    }
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror   = (e) => reject(e.target.error)
  })
}

export async function queueCto(payload) {
  const db    = await openDB()
  const tx    = db.transaction(STORE, 'readwrite')
  const store = tx.objectStore(STORE)
  store.add({ ...payload, _queuedAt: Date.now() })
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej })
}

export async function getPendingCtos() {
  const db    = await openDB()
  const tx    = db.transaction(STORE, 'readonly')
  const store = tx.objectStore(STORE)
  return new Promise((res, rej) => {
    const req = store.getAll()
    req.onsuccess = () => res(req.result)
    req.onerror   = () => rej(req.error)
  })
}

export async function removePendingCto(localId) {
  const db    = await openDB()
  const tx    = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).delete(localId)
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej })
}

export async function getPendingCount() {
  const items = await getPendingCtos()
  return items.length
}
