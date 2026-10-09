/**
 * A deliberately small parser for the QuickBooks query language.
 * https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries
 *
 *   SELECT * | COUNT(*) FROM Entity [WHERE Property = value | Property IN (value, ...)] [STARTPOSITION n] [MAXRESULTS n]
 *
 * Reserved words, entity names, and property names are case-insensitive. Values are 'quoted strings'
 * (with \' for an apostrophe), numbers, true, or false. The rest of the language (AND, LIKE, <, >,
 * ORDERBY) is valid QuickBooks, so the parser reports it as "unsupported" rather than as a syntax error.
 * Extend it one clause at a time, with a test for each, rather than reaching for a general SQL parser.
 */

export type QueryValue = string | number | boolean;

export interface QboQuery {
  select: "*" | "count";
  entity: string;
  where?: { property: string; operator: "=" | "in"; values: QueryValue[] };
  startPosition: number; // 1-based, like QuickBooks
  maxResults: number;
}

export interface QueryError {
  kind: "syntax" | "unsupported";
  error: string;
}

const DEFAULT_MAX_RESULTS = 100; // "If the result size isn't specified, the default number is 100."
const MAX_RESULTS_LIMIT = 1000; // "The maximum number of entities that can be returned in a response is 1,000."

export function parseQboQuery(text: string): QboQuery | QueryError {
  const tokens = tokenize(text);
  if (!Array.isArray(tokens)) return tokens;
  try {
    return new Parser(tokens).statement();
  } catch (error) {
    if (error instanceof ParseFailure) return { kind: error.kind, error: error.message };
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------
// tokens

type Token = { kind: "word" | "number" | "string" | "symbol"; text: string };

function tokenize(text: string): Token[] | QueryError {
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
      if (i >= text.length) return { kind: "syntax", error: "A quoted value is missing its closing quote" };
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
    if (!match?.text) return { kind: "syntax", error: `Unexpected character "${text[i]}" at position ${i + 1}` };
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

// ---------------------------------------------------------------------------------------------------
// statement

class ParseFailure extends Error {
  constructor(
    readonly kind: QueryError["kind"],
    message: string,
  ) {
    super(message);
  }
}

class Parser {
  private position = 0;

  constructor(private readonly tokens: Token[]) {}

  statement(): QboQuery {
    this.expectWord("SELECT");
    const select = this.selectList();
    this.expectWord("FROM");
    const entity = this.expect("word", "an entity name after FROM").text;

    const query: QboQuery = { select, entity, startPosition: 1, maxResults: DEFAULT_MAX_RESULTS };
    if (this.acceptWord("WHERE")) query.where = this.condition();
    if (this.peekWord("AND")) throw new ParseFailure("unsupported", "The twin supports one WHERE condition so far, not AND");
    if (this.peekWord("ORDERBY")) throw new ParseFailure("unsupported", "The twin does not support ORDERBY yet");
    if (this.acceptWord("STARTPOSITION")) query.startPosition = this.positiveInteger("STARTPOSITION");
    if (this.acceptWord("MAXRESULTS")) query.maxResults = Math.min(this.positiveInteger("MAXRESULTS"), MAX_RESULTS_LIMIT);

    const extra = this.tokens[this.position];
    if (extra) throw new ParseFailure("syntax", `Unexpected "${extra.text}" after the end of the statement`);
    return query;
  }

  private selectList(): QboQuery["select"] {
    if (this.acceptSymbol("*")) return "*";
    if (this.acceptWord("COUNT")) {
      throw new ParseFailure("unsupported", "The twin does not support COUNT(*) yet");
    }
    throw new ParseFailure("syntax", "Expected * after SELECT. Projections (SELECT Field, ...) are not part of the query language");
  }

  private condition(): NonNullable<QboQuery["where"]> {
    const property = this.expect("word", "a property name after WHERE").text;
    const operator = this.tokens[this.position];
    if (operator?.text === "=") {
      this.position++;
      return { property, operator: "=", values: [this.value()] };
    }
    if (operator?.kind === "word" && operator.text.toUpperCase() === "IN") {
      this.position++;
      this.expectSymbol("(");
      const values = [this.value()];
      while (this.acceptSymbol(",")) values.push(this.value());
      this.expectSymbol(")");
      return { property, operator: "in", values };
    }
    // Valid QuickBooks, but not modeled yet. (On Id, QuickBooks itself allows only = and IN.)
    if (operator && /^(like|<|>|<=|>=|!=)$/i.test(operator.text)) {
      throw new ParseFailure("unsupported", `The twin supports = and IN in WHERE so far, not ${operator.text.toUpperCase()}`);
    }
    throw new ParseFailure("syntax", `Expected an operator after ${property}`);
  }

  private value(): QueryValue {
    const token = this.tokens[this.position++];
    if (token?.kind === "string") return token.text;
    if (token?.kind === "number") return Number(token.text);
    if (token?.kind === "word" && /^(true|false)$/i.test(token.text)) return token.text.toLowerCase() === "true";
    throw new ParseFailure("syntax", `Expected a value like 'text', 42, true, or false${token ? `, got "${token.text}"` : ""}`);
  }

  private positiveInteger(clause: string): number {
    const token = this.expect("number", `a number after ${clause}`);
    const value = Number(token.text);
    if (!Number.isInteger(value) || value < 1) throw new ParseFailure("syntax", `${clause} must be a positive integer`);
    return value;
  }

  private expect(kind: Token["kind"], description: string): Token {
    const token = this.tokens[this.position];
    if (token?.kind !== kind) throw new ParseFailure("syntax", `Expected ${description}${token ? `, got "${token.text}"` : ""}`);
    this.position++;
    return token;
  }

  private expectWord(word: string): void {
    if (this.acceptWord(word)) return;
    const token = this.tokens[this.position];
    throw new ParseFailure("syntax", `Expected ${word}${token ? `, got "${token.text}"` : ""}`);
  }

  private acceptWord(word: string): boolean {
    if (!this.peekWord(word)) return false;
    this.position++;
    return true;
  }

  private peekWord(word: string): boolean {
    const token = this.tokens[this.position];
    return token?.kind === "word" && token.text.toUpperCase() === word;
  }

  private expectSymbol(symbol: string): void {
    if (this.acceptSymbol(symbol)) return;
    const token = this.tokens[this.position];
    throw new ParseFailure("syntax", `Expected "${symbol}"${token ? `, got "${token.text}"` : ""}`);
  }

  private acceptSymbol(symbol: string): boolean {
    if (this.tokens[this.position]?.text !== symbol) return false;
    this.position++;
    return true;
  }
}
