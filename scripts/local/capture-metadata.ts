import { NativeConnection, type Hex } from "@account-handoff/native-adapter";

const endpoint = process.argv[2];
const blockHash = process.argv[3];
if (!endpoint || !blockHash || !/^0x[0-9a-f]{64}$/i.test(blockHash))
  throw new Error("Expected a LOCAL endpoint and exact finalized block hash");
const connection = await NativeConnection.connect(endpoint, "LOCAL");
try {
  process.stdout.write(
    JSON.stringify(await connection.captureMetadata(blockHash as Hex)),
  );
} finally {
  await connection.close();
}
