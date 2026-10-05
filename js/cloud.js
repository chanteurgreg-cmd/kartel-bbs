// Sauvegarde et synchronisation en ligne (fonction Supabase kartel-backup) : tablettes du salon et téléphone du
// patron partagent le même état. Le salon est identifié par un code de 12 caractères, généré sur la tablette.
const ENDPOINT = 'https://xrtpqsddxwyipqftqrgk.supabase.co/functions/v1/kartel-backup';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I ni O, pour éviter les confusions à la saisie

export function newKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => ALPHABET[b % 32]).join('');
}

export function newDeviceId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(36).padStart(2, '0')).join('');
}

export const formatKey = (key) => key.match(/.{1,4}/g).join('-');
export const normalizeKey = (text) => String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Compressé, un an de caisse pèse une centaine de Ko au lieu de quelques Mo.
async function pack(text) {
  if (typeof CompressionStream === 'undefined') return { body: text, enc: 'plain' };
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return { body: await new Response(stream).arrayBuffer(), enc: 'gzip' };
}

async function call(action, key, device, { body, enc, since } = {}) {
  const query = new URLSearchParams({ action, key, device });
  if (enc) query.set('enc', enc);
  if (since) query.set('since', String(since));
  const res = await fetch(`${ENDPOINT}?${query}`, {
    method: 'POST',
    body,
    headers: body ? { 'Content-Type': 'application/octet-stream' } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Envoie l'état de cet appareil ; la réponse contient l'état fusionné avec celui des autres appareils.
export async function upload(state, device) {
  const { body, enc } = await pack(JSON.stringify(state));
  return call('sync', state.meta.salonKey, device, { body, enc });
}

// since : date de la dernière version reçue ; la réponse est { same: true } si rien n'a bougé depuis.
export const download = (key, device, since = 0) => call('load', key, device, { since });
