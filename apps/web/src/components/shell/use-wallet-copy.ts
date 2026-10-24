import { useCallback, useRef, useState } from "react";
import { displayAddress } from "../addresses/format";

export function useWalletCopy(address: string | null) {
  const current = useRef(address);
  current.current = address;
  const [result, setResult] = useState<{
    address: string;
    state: "copied" | "failed";
  } | null>(null);
  const clear = useCallback(() => setResult(null), []);
  const copy = useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(displayAddress(address));
      if (current.current === address) setResult({ address, state: "copied" });
    } catch {
      if (current.current === address) setResult({ address, state: "failed" });
    }
  }, [address]);
  return {
    state: result?.address === address ? result.state : "idle",
    copy,
    clear,
  };
}
