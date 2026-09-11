// Persistance de l'état : IndexedDB (pas de plafond à 5 Mo comme localStorage), repli localStorage.
const DB_NAME = 'kartel-bbs';
const STORE = 'kv';
let key = 'state';
let dbPromise = null;
let queue = Promise.resolve();

// Le mode démo écrit sous une autre clé : jamais mélangé aux vraies données du salon.
export function useKey(mode) {
  key = mode === 'demo' ? 'state-demo' : 'state';
}

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run(mode, op) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = op(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export async function load() {
  try {
    return (await run('readonly', (s) => s.get(key))) ?? null;
  } catch {
    const raw = localStorage.getItem('kartel-bbs-' + key);
    return raw ? JSON.parse(raw) : null;
  }
}

// Les écritures sont enchaînées pour ne jamais s'écraser dans le désordre.
export function save(state) {
  queue = queue
    .then(() => run('readwrite', (s) => s.put(state, key)))
    .catch(() => {
      try {
        localStorage.setItem('kartel-bbs-' + key, JSON.stringify(state));
      } catch {
        // Stockage plein ou bloqué : l'interface reste utilisable, la sauvegarde fichier reste possible.
      }
    });
  return queue;
}

// Demande au navigateur de ne jamais effacer ces données pour faire de la place.
export async function persist() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
