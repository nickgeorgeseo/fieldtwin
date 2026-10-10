/**
 * Splits a QuickBooks query into tokens for query-language.ts.
 * https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries
 */

export type Token = { kind: "word" | "number" | "string" | "symbol"; text: string };

/** The words, numbers, 'quoted values', and symbols of a query, or what stops it from being split into them. */
export function tokenize(text: string): Token[] | { error: string } {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "'") {
      // A quoted value. A backslash escapes the next character: 'Adam\'s Candy Shop'.
      let value = "";
      i++;
      while (i < text.length && text[i] !== "'") {
        if (text[i] === "\\" && i + 1 < text.length) i++;
        value += text[i++];
      }
      if (i >= text.length) return { error: "A quoted value is missing its closing quote" };
      tokens.push({ kind: "string", text: value });
      i++;
      continue;
    }

    const rest = text.slice(i);
    const space = /^\s+/.exec(rest)?.[0];
    if (space) {
      i += space.length;
      continue;
    }
    const match = SIMPLE_TOKENS.map(({ kind, pattern }) => ({ kind, text: pattern.exec(rest)?.[0] })).find((token) => token.text);
    if (!match?.text) return { error: `Unexpected character "${text[i]}" at position ${i + 1}` };
    tokens.push({ kind: match.kind, text: match.text });
    i += match.text.length;
  }
  return tokens;
}

const SIMPLE_TOKENS: { kind: Token["kind"]; pattern: RegExp }[] = [
  { kind: "word", pattern: /^[A-Za-z_][A-Za-z0-9_.]*/ }, // keywords, entities, properties (MetaData.CreateTime)
  { kind: "number", pattern: /^\d+(\.\d+)?/ },
  { kind: "symbol", pattern: /^(<=|>=|!=|[()*,=<>])/ },
];
