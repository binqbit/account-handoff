import { hex, type Hex } from "@account-handoff/native-adapter";

/** Bound each HTTP response, independently of Node's five-minute header timeout. */
export async function buildBlocks(count = 1): Promise<Hex> {
  if (!Number.isSafeInteger(count) || count < 1)
    throw new Error("Expected a positive whole block count");
  let result: Hex | undefined;
  for (let remaining = count; remaining > 0; remaining -= 20) {
    const response = await fetch("http://127.0.0.1:8059", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "dev_newBlock",
        params: [{ count: Math.min(20, remaining) }],
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error(`Fork RPC HTTP ${response.status}`);
    const json = await response.json();
    if (json.error) throw new Error(JSON.stringify(json.error));
    result = hex(json.result, 32);
  }
  return result!;
}
