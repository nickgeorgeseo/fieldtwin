/**
 * A deliberately small parser for the QuickBooks query language.
 *
 * Supported today:  SELECT * FROM Customer [WHERE Field = 'value'] [STARTPOSITION n] [MAXRESULTS n]
 * Anything else returns a clear error instead of a wrong answer. Extend it one clause at a time,
 * with a test for each clause, rather than reaching for a general SQL parser.
 */

export interface QboQuery {
  entity: string;
  where?: { field: string; value: string };
  startPosition: number; // 1-based, like QuickBooks
  maxResults: number;
}

const QUERY_PATTERN =
  /^select \* from (\w+)(?: where (\w+) = '([^']*)')?(?: startposition (\d+))?(?: maxresults (\d+))?\s*$/i;

export function parseQboQuery(text: string): QboQuery | { error: string } {
  const match = QUERY_PATTERN.exec(text.trim());
  if (!match) {
    return { error: `The twin only supports SELECT * FROM Entity [WHERE Field = 'value'] [STARTPOSITION n] [MAXRESULTS n]. Got: ${text}` };
  }

  const [, entity, whereField, whereValue, start, max] = match;
  return {
    entity: entity!,
    where: whereField ? { field: whereField, value: whereValue ?? "" } : undefined,
    startPosition: start ? Number(start) : 1,
    maxResults: Math.min(max ? Number(max) : 100, 1000),
  };
}
