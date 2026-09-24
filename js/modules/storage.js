// Persistent storage helpers.
//
// localStorage is small (~5 MB per origin) and throws when it's full, so
// every write goes through writeJSON(), which reports failure to the user
// instead of throwing out of a click handler. Saved selfies — which carry
// base64 images and recorded sounds — live in IndexedDB instead, where the
// quota is far larger; the old localStorage copy is migrated on first use.

// ── localStorage ────────────────────────────────────────────────────────────

export function readJSON(key, fallback) {
  try {
    var raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

// Returns true on success. `what` names the thing being saved for the
// error message (e.g. 'song'); pass null to fail silently.
export function writeJSON(key, value, what) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('Could not save ' + key, e);
    if (what) reportSaveFailure(what, e);
    return false;
  }
}

export function removeKey(key) {
  try { localStorage.removeItem(key); } catch (e) {}
}

function isQuotaError(e) {
  return !!e && (e.name === 'QuotaExceededError' ||
                 e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
                 e.code === 22 || e.code === 1014);
}

export function reportSaveFailure(what, e) {
  alert(isQuotaError(e)
    ? 'Could not save the ' + what + ': browser storage is full. Delete some saved selfies, songs or rhythms and try again.'
    : 'Could not save the ' + what + '. Your browser may be blocking storage for this site (e.g. private browsing).');
}

// ── IndexedDB (saved selfies) ───────────────────────────────────────────────

var DB_NAME = 'vm';
var DB_VERSION = 1;
var SELFIE_STORE = 'selfies';
var LEGACY_SELFIES_KEY = 'vm_saved_selfies';

var dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(function(resolve, reject) {
    if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    var req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function() {
      var db = req.result;
      if (!db.objectStoreNames.contains(SELFIE_STORE)) {
        db.createObjectStore(SELFIE_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error); };
    req.onblocked = function() { reject(new Error('IndexedDB blocked')); };
  }).then(migrateLegacySelfies);
  // Don't cache a failure — a later call may succeed (and falls back anyway).
  dbPromise.catch(function() { dbPromise = null; });
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise(function(resolve, reject) {
    var t = db.transaction(SELFIE_STORE, mode);
    var store = t.objectStore(SELFIE_STORE);
    var result = fn(store);
    t.oncomplete = function() { resolve(result && 'result' in result ? result.result : undefined); };
    t.onerror = function() { reject(t.error); };
    t.onabort = function() { reject(t.error || new Error('Transaction aborted')); };
  });
}

// Move selfies saved by older versions out of localStorage, freeing that
// space for songs, rhythms and settings.
function migrateLegacySelfies(db) {
  var legacy = readJSON(LEGACY_SELFIES_KEY, null);
  if (!Array.isArray(legacy) || legacy.length === 0) return db;
  return tx(db, 'readwrite', function(store) {
    legacy.forEach(function(s) { if (s && s.id != null) store.put(s); });
  }).then(function() {
    removeKey(LEGACY_SELFIES_KEY);
    return db;
  }, function(e) {
    console.warn('Selfie migration failed; keeping localStorage copy', e);
    return db;
  });
}

export function getSavedSelfies() {
  return openDB()
    .then(function(db) { return tx(db, 'readonly', function(store) { return store.getAll(); }); })
    .then(function(list) {
      return (list || []).sort(function(a, b) { return a.id - b.id; });
    })
    .catch(function() { return readJSON(LEGACY_SELFIES_KEY, []); });
}

// Resolves true on success; reports the failure to the user otherwise.
export function putSavedSelfie(entry) {
  return openDB()
    .then(function(db) {
      return tx(db, 'readwrite', function(store) { store.put(entry); });
    }, function() {
      // No IndexedDB: fall back to localStorage.
      // JSON can't hold the recorded sound Blob, so it's dropped here.
      var list = readJSON(LEGACY_SELFIES_KEY, []);
      list.push(Object.assign({}, entry, { sound: null }));
      if (!writeJSON(LEGACY_SELFIES_KEY, list, 'selfie')) throw null;
    })
    .then(function() { return true; }, function(e) {
      if (e) reportSaveFailure('selfie', e);
      return false;
    });
}

export function deleteSavedSelfie(id) {
  return openDB()
    .then(function(db) {
      return tx(db, 'readwrite', function(store) { store.delete(id); });
    }, function() {
      var list = readJSON(LEGACY_SELFIES_KEY, []).filter(function(s) { return s.id !== id; });
      writeJSON(LEGACY_SELFIES_KEY, list, null);
    })
    .catch(function(e) { console.warn('Could not delete selfie', e); });
}
