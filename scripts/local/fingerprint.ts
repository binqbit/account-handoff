import { NativeConnection } from "@account-handoff/native-adapter";

const endpoint = process.argv[2];
if (!endpoint) throw new Error("Expected a LOCAL native endpoint");
const connection = await NativeConnection.connect(endpoint, "LOCAL");
try {
  process.stdout.write(JSON.stringify(await connection.fingerprint()));
} finally {
  await connection.close();
}
