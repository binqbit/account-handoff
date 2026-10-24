import { readFileSync } from "node:fs";
import {
  NativeConnection,
  type NativeMetadataBinding,
} from "@account-handoff/native-adapter";

const endpoint = process.argv[2];
if (!endpoint) throw new Error("Expected a LOCAL native endpoint");
const bindingPath = process.argv[3];
const binding: NativeMetadataBinding | undefined = bindingPath
  ? JSON.parse(readFileSync(bindingPath, "utf8"))
  : undefined;
const connection = await NativeConnection.connect(endpoint, "LOCAL", binding);
try {
  process.stdout.write(JSON.stringify(await connection.fingerprint()));
} finally {
  await connection.close();
}
