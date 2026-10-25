import { id } from "./values";

const storageKey = "account-handoff:operation-tab";
let documentIdentity: Promise<string> | undefined;

/** Keep a lease owner across reloads without sharing it with a duplicated tab. */
export function operationTabId(): Promise<string> {
  if (typeof window === "undefined" || !navigator.locks)
    return Promise.resolve(id());
  return (documentIdentity ??= claimIdentity());
}

async function claimIdentity(): Promise<string> {
  let candidate: string = id();
  try {
    candidate = sessionStorage.getItem(storageKey) || candidate;
  } catch {
    // A storage-restricted document still gets an isolated owner.
  }
  for (;;) {
    const owner = candidate;
    const claimed = await new Promise<boolean>((resolve, reject) => {
      void navigator.locks
        .request(`${storageKey}:${owner}`, { ifAvailable: true }, (lock) => {
          resolve(lock !== null);
          // The browser releases this lock when the document is destroyed.
          return lock ? new Promise<void>(() => {}) : undefined;
        })
        .catch(reject);
    });
    if (claimed) {
      try {
        sessionStorage.setItem(storageKey, owner);
      } catch {
        // Do not weaken cross-tab exclusion if session storage is unavailable.
      }
      return owner;
    }
    // sessionStorage is copied by window.open/duplicating a tab. An active
    // document already owns this value, so the new document needs its own ID.
    candidate = id();
  }
}
