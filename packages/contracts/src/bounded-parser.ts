import { ContractError } from "./errors.js";

export interface ParseLimits {
  maxBytes: number;
  maxDepth: number;
  maxArrayItems: number;
  maxRecordItems: number;
  maxObservationItems: number;
}

export const PORTABLE_LIMITS: Readonly<ParseLimits> = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  maxDepth: 32,
  maxArrayItems: 256,
  maxRecordItems: 1000,
  maxObservationItems: 4096,
});

export function assertUnicode(text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw new ContractError("InvalidUnicode", "Unpaired high surrogate");
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new ContractError("InvalidUnicode", "Unpaired low surrogate");
    }
  }
}

/** Recursive descent retains object-key identity before ordinary JSON parsing could discard duplicates. */
export function parseBoundedJson(
  input: string | Uint8Array,
  overrides: Partial<ParseLimits> = {},
): unknown {
  const limits = { ...PORTABLE_LIMITS, ...overrides };
  let text: string;
  if (typeof input === "string") {
    assertUnicode(input);
    if (new TextEncoder().encode(input).byteLength > limits.maxBytes)
      throw new ContractError("InputTooLarge", "JSON exceeds byte limit");
    text = input;
  } else {
    if (input.byteLength > limits.maxBytes)
      throw new ContractError("InputTooLarge", "JSON exceeds byte limit");
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input);
    } catch {
      throw new ContractError("InvalidUtf8", "JSON is not valid UTF-8");
    }
  }
  let position = 0;
  const fail = (message: string): never => {
    throw new ContractError(
      "InvalidJson",
      `${message} at character ${position}`,
    );
  };
  const whitespace = (): void => {
    while (/\s/u.test(text[position] ?? "") && position < text.length) {
      if (![" ", "\n", "\r", "\t"].includes(text[position]!))
        fail("Invalid whitespace");
      position += 1;
    }
  };
  const string = (): string => {
    if (text[position] !== '"') return fail("Expected string");
    const start = position++;
    while (position < text.length) {
      const c = text[position++];
      if (c === '"') {
        let result: unknown;
        try {
          result = JSON.parse(text.slice(start, position));
        } catch {
          return fail("Invalid string");
        }
        if (typeof result !== "string") return fail("Invalid string");
        assertUnicode(result);
        return result;
      }
      if (c === "\\") {
        if (text[position] === "u") position += 5;
        else position += 1;
      } else if (c !== undefined && c.charCodeAt(0) < 0x20)
        return fail("Control character in string");
    }
    return fail("Unterminated string");
  };
  const value = (depth: number, key = ""): unknown => {
    if (depth > limits.maxDepth)
      throw new ContractError("InputTooDeep", "JSON exceeds depth limit");
    whitespace();
    const c = text[position];
    if (c === '"') return string();
    if (c === "{") {
      position += 1;
      whitespace();
      const result: Record<string, unknown> = Object.create(null) as Record<
        string,
        unknown
      >;
      const keys = new Set<string>();
      if (text[position] === "}") {
        position += 1;
        return result;
      }
      while (position < text.length) {
        whitespace();
        const name = string();
        whitespace();
        if (keys.has(name))
          throw new ContractError(
            "DuplicateKey",
            `Duplicate JSON key: ${name}`,
          );
        if (
          name === "__proto__" ||
          name === "constructor" ||
          name === "prototype"
        )
          throw new ContractError("UnsafeKey", `Unsupported JSON key: ${name}`);
        keys.add(name);
        if (text[position++] !== ":") return fail("Expected colon");
        result[name] = value(depth + 1, name);
        whitespace();
        const next = text[position++];
        if (next === "}") return result;
        if (next !== ",") return fail("Expected comma");
      }
      return fail("Unterminated object");
    }
    if (c === "[") {
      position += 1;
      whitespace();
      const result: unknown[] = [];
      const cap =
        key === "records"
          ? limits.maxRecordItems
          : ["events", "observations"].includes(key)
            ? limits.maxObservationItems
            : limits.maxArrayItems;
      if (text[position] === "]") {
        position += 1;
        return result;
      }
      while (position < text.length) {
        if (result.length >= cap)
          throw new ContractError(
            "TooManyItems",
            `Array ${key || "(anonymous)"} exceeds ${cap} items`,
          );
        result.push(value(depth + 1));
        whitespace();
        const next = text[position++];
        if (next === "]") return result;
        if (next !== ",") return fail("Expected comma");
      }
      return fail("Unterminated array");
    }
    for (const [literal, result] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (text.startsWith(literal, position)) {
        position += literal.length;
        return result;
      }
    }
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
      text.slice(position),
    );
    if (match) {
      position += match[0].length;
      const result = Number(match[0]);
      if (
        !Number.isFinite(result) ||
        (Number.isInteger(result) && !Number.isSafeInteger(result))
      )
        throw new ContractError(
          "UnsafeNumber",
          "JSON integer cannot be represented exactly",
        );
      return result;
    }
    return fail("Expected JSON value");
  };
  const result = value(0);
  whitespace();
  if (position !== text.length) fail("Unexpected trailing input");
  return result;
}
