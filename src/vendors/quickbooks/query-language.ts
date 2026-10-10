/**
 * A deliberately small parser for the QuickBooks query language.
 * https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries
 *
 *   SELECT * | COUNT(*) FROM Entity
 *     [WHERE Property Operator Value [AND Property Operator Value ...]]
 *     [ORDERBY Property [ASC | DESC] [, Property [ASC | DESC] ...]]
 *     [STARTPOSITION n] [MAXRESULTS n]
 *
 * Operators are =, <, >, <=, >=, LIKE (with % as the only wildcard), and IN (value, ...). There is no OR.
 * Reserved words, entity names, and property names are case-insensitive. Values are 'quoted strings'
 * (with \' for an apostrophe), numbers, true, or false. What the parser doesn't model yet (!=, CURRENT_DATE)
 * it reports as "unsupported" rather than as a syntax error. Which properties an entity can filter and sort
 * on, and how values compare, is up to the query route. Extend this one clause at a time, with a test for
 * each, rather than reaching for a general SQL parser.
 */

import { type Token, tokenize } from "./query-tokens.ts";

export type QueryValue = string | number | boolean;

export type QueryOperator = "=" | "<" | ">" | "<=" | ">=" | "like" | "in";

export interface QueryCondition {
  property: string;
  operator: QueryOperator;
  values: QueryValue[]; // one value, or IN's list
}

export interface QboQuery {
  select: "*" | "count";
  entity: string;
  where: QueryCondition[]; // every one must hold: conditions are joined by AND
  orderBy: { property: string; descending: boolean }[];
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
  if (!Array.isArray(tokens)) return { kind: "syntax", error: tokens.error };
  try {
    return new Parser(tokens).statement();
  } catch (error) {
    if (error instanceof ParseFailure) return { kind: error.kind, error: error.message };
    throw error;
  }
}

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

    const query: QboQuery = { select, entity, where: [], orderBy: [], startPosition: 1, maxResults: DEFAULT_MAX_RESULTS };
    if (this.acceptWord("WHERE")) {
      do query.where.push(this.condition());
      while (this.acceptWord("AND"));
    }
    // "Query operations don't support ... OR operations in WHERE clauses."
    if (this.peekWord("OR"))
      throw new ParseFailure("syntax", "The query language has no OR. Use IN (value, ...) for several values of one property");
    if (this.peekWord("ORDER")) throw new ParseFailure("syntax", "Write ORDERBY as one word, the way Intuit's docs do");
    if (this.acceptWord("ORDERBY")) {
      do query.orderBy.push(this.sortKey());
      while (this.acceptSymbol(","));
    }
    if (this.acceptWord("STARTPOSITION")) query.startPosition = this.positiveInteger("STARTPOSITION");
    if (this.acceptWord("MAXRESULTS")) query.maxResults = Math.min(this.positiveInteger("MAXRESULTS"), MAX_RESULTS_LIMIT);

    const extra = this.tokens[this.position];
    if (extra) throw new ParseFailure("syntax", `Unexpected "${extra.text}" after the end of the statement`);
    return query;
  }

  private selectList(): QboQuery["select"] {
    if (this.acceptSymbol("*")) return "*";
    // "count(*): The number of records that satisfy the query criteria."
    if (this.acceptWord("COUNT")) {
      this.expectSymbol("(");
      this.expectSymbol("*");
      this.expectSymbol(")");
      return "count";
    }
    throw new ParseFailure("syntax", "Expected * after SELECT. Projections (SELECT Field, ...) are not part of the query language");
  }

  private condition(): QueryCondition {
    const property = this.expect("word", "a property name after WHERE").text;
    const operator = this.operator(property);
    if (operator === "in") {
      this.expectSymbol("(");
      const values = [this.value()];
      while (this.acceptSymbol(",")) values.push(this.value());
      this.expectSymbol(")");
      return { property, operator, values };
    }
    const value = this.value();
    if (operator === "like" && typeof value !== "string") throw new ParseFailure("syntax", "LIKE needs a quoted pattern, like 'Palm%'");
    return { property, operator, values: [value] };
  }

  private operator(property: string): QueryOperator {
    const text = this.tokens[this.position]?.text.toLowerCase();
    if (text === "=" || text === "<" || text === ">" || text === "<=" || text === ">=" || text === "like" || text === "in") {
      this.position++;
      return text;
    }
    if (text === "!=")
      throw new ParseFailure("unsupported", "The twin doesn't support != (it isn't among the operators Intuit's docs list)");
    throw new ParseFailure("syntax", `Expected an operator (=, <, >, <=, >=, LIKE, or IN) after ${property}`);
  }

  private sortKey(): QboQuery["orderBy"][number] {
    const property = this.expect("word", "a property name after ORDERBY").text;
    // "The default sort order is ascending. To indicate descending sort order, include DESC."
    const descending = this.acceptWord("DESC");
    if (!descending) this.acceptWord("ASC");
    return { property, descending };
  }

  private value(): QueryValue {
    const token = this.tokens[this.position++];
    if (token?.kind === "string") return token.text;
    if (token?.kind === "number") return Number(token.text);
    if (token?.kind === "word" && /^(true|false)$/i.test(token.text)) return token.text.toLowerCase() === "true";
    if (token?.kind === "word" && token.text.toUpperCase() === "CURRENT_DATE") {
      throw new ParseFailure("unsupported", "The twin doesn't support CURRENT_DATE yet. Send the date instead, like '2026-07-13'");
    }
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
