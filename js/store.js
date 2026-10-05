// Persistance de l'état : IndexedDB (pas de plafond à 5 Mo comme localStorage), repli localStorage.
const DB_NAME = 'kartel-bbs';
const STORE = 'kv';
let key = 'state';
let dbPromise = null;
let queue = Promise.resolve();

// Chaque salon a sa case (« state » pour le premier de l'appareil, « salon-CODE » pour les suivants) ;
// le mode démo écrit dans la sienne, jamais mélangée aux vraies données.
export function useKey(slot) {
  key = slot === 'demo' ? 'state-demo' : slot;
}

// Lecture et écriture d'une autre case que celle du salon affiché (vue « Mes salons »).
export async function loadSlot(slot) {
  try {
    return (await run('readonly', (s) => s.get(slot))) ?? null;
  } catch {
    const raw = localStorage.getItem('kartel-bbs-' + slot);
    return raw ? JSON.parse(raw) : null;
  }
}

export function saveSlot(slot, state) {
  queue = queue
    .then(() => run('readwrite', (s) => s.put(state, slot)))
    .catch(() => {
      try {
        localStorage.setItem('kartel-bbs-' + slot, JSON.stringify(state));
      } catch {
        // Stockage plein ou bloqué : la copie en ligne reste la référence.
      }
    });
  return queue;
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

export const load = () => loadSlot(key);

// Les écritures sont enchaînées pour ne jamais s'écraser dans le désordre.
export const save = (state) => saveSlot(key, state);

// Demande au navigateur de ne jamais effacer ces données pour faire de la place.
export async function persist() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
