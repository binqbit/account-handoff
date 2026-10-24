import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import standaloneCode from "ajv/dist/standalone/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  code: { source: true, esm: true },
});
for (const name of [
  "contracts.schema.json",
  "local-journal.schema.json",
  "portable-package.schema.json",
]) {
  ajv.addSchema(
    JSON.parse(await readFile(path.join(root, "schema", name), "utf8")),
  );
}
let code = standaloneCode(ajv, {
  validateRecordSchema: "urn:grc:contracts:2",
  validateProgressSchema: "urn:grc:local-journal:1",
  validatePackageSchema: "urn:grc:portable-package:2",
  validateIntentSchema: "urn:grc:contracts:2#/$defs/Intent",
  validateCallTreeSchema: "urn:grc:contracts:2#/$defs/CallTree",
});
// Ajv's ESM generator still emits CommonJS references for these two runtime helpers.
// Normalize only its known helper expressions; fail on new helper requirements.
const helperImports = [];
for (const [name, local] of [
  ["ucs2length", "ajvUcs2length"],
  ["equal", "ajvEqual"],
]) {
  const expression = `require("ajv/dist/runtime/${name}").default`;
  if (!code.includes(expression)) continue;
  helperImports.push(
    `import ${local}Module from "ajv/dist/runtime/${name}.js";\nconst ${local} = ${local}Module.default ?? ${local}Module;`,
  );
  code = code.replaceAll(expression, local);
}
if (/\brequire\s*\(/u.test(code))
  throw new Error("Unreviewed CommonJS helper in generated browser validator");
code = `${helperImports.join("\n")}\n${code}`;
await mkdir(path.join(root, "generated"), { recursive: true });
await writeFile(path.join(root, "generated/validators.js"), code);
await writeFile(
  path.join(root, "generated/validators.d.ts"),
  `import type { ErrorObject } from 'ajv';
type Validator = ((data: unknown) => boolean) & { errors?: ErrorObject[] | null };
export const validateRecordSchema: Validator;
export const validateProgressSchema: Validator;
export const validatePackageSchema: Validator;
export const validateIntentSchema: Validator;
export const validateCallTreeSchema: Validator;
`,
);
