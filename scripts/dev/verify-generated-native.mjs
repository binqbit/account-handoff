import { fileURLToPath } from "node:url";
import { verifyGeneratedNativeArtifacts } from "./native-artifacts.mjs";

const result = verifyGeneratedNativeArtifacts(
  process.argv[2] ?? fileURLToPath(new URL("../..", import.meta.url)),
);
console.log(
  JSON.stringify({
    status: "VERIFIED",
    files: result.files.length,
    metadataSha256: result.metadataSha256,
    generatedNativeTypesSha256: result.generatedNativeTypesSha256,
  }),
);
