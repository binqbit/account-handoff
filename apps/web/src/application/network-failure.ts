import { MaxRetryAttemptedError, NetworkDisconnectedError } from "dedot";
import { DedotError } from "dedot/utils";

function isBrowserSocketError(error: unknown): boolean {
  if (
    typeof Event !== "undefined" &&
    error instanceof Event &&
    error.type === "error"
  )
    return true;
  // Dedot 1.4.0 wraps initial browser socket events with Error(String(event)).
  return (
    error instanceof Error &&
    (error.message === "[object Event]" ||
      error.message === "[object ErrorEvent]")
  );
}

/** Keep browser socket failures readable without hiding their original cause. */
export function normalizeNetworkFailure(error: unknown): unknown {
  if (!isBrowserSocketError(error)) return error;
  return new NetworkDisconnectedError(
    "Could not reach the network. Check your internet connection or try again.",
    { cause: error },
  );
}

/** Only demonstrated transport failures may trigger an automatic read-only retry. */
export function isRetryableNetworkFailure(error: unknown): boolean {
  if (
    error instanceof MaxRetryAttemptedError ||
    error instanceof NetworkDisconnectedError
  )
    return true;
  if (isBrowserSocketError(error)) return true;
  if (!(error instanceof Error)) return false;
  // Its request timeout uses the otherwise generic DedotError class.
  return (
    error instanceof DedotError &&
    /^Request timed out after \d+ms$/.test(error.message)
  );
}
