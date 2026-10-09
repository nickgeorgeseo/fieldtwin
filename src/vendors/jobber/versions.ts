/**
 * Jobber's dated API versions, sent in the X-JOBBER-GRAPHQL-VERSION header.
 * Versioning rules: https://developer.getjobber.com/docs/using_jobbers_api/api_versioning/
 * Version list:     https://developer.getjobber.com/docs/changelog/
 *
 * The twin serves the same schema subset for every version: none of the breaking changes in the
 * changelog touch a field the twin models. Versioning still matters to callers, because a client
 * that sends no version, or one Jobber never released, should fail here before it fails in production.
 */

/** "Active GraphQL API Versions" from the changelog, newest first. */
export const ACTIVE_VERSIONS = [
  "2026-09-25",
  "2026-05-12",
  "2026-04-22",
  "2026-04-16",
  "2026-04-13",
  "2026-03-10",
  "2026-02-17",
  "2025-04-16",
  "2025-01-20",
  "2024-12-05",
  "2024-11-12",
  "2024-11-07",
  "2024-09-23",
  "2024-09-12",
  "2024-08-30",
  "2024-06-10",
  "2024-04-17",
  "2023-11-15",
  "2023-08-18",
  "2023-05-05",
  "2023-03-29",
  "2022-12-07",
  "2022-09-15",
  "2022-05-23",
] as const;

/**
 * "Historic GraphQL API Versions" from the changelog. These are inactive, and requests for them
 * "will be automatically resolved against the nearest active version", which is the oldest active one.
 */
export const HISTORIC_VERSIONS = ["2022-03-10", "2022-01-01"] as const;

const OLDEST_ACTIVE: string = ACTIVE_VERSIONS[ACTIVE_VERSIONS.length - 1]!;

/** The version a request is served with, or an error message saying what to send instead. */
export function resolveVersion(header: string | undefined): { version: string } | { error: string } {
  const supported = `Active versions: ${ACTIVE_VERSIONS[0]} (latest) back to ${OLDEST_ACTIVE}.`;
  if (!header) {
    return { error: `Missing X-JOBBER-GRAPHQL-VERSION header. Jobber requires it on every request. ${supported}` };
  }
  if ((ACTIVE_VERSIONS as readonly string[]).includes(header)) return { version: header };
  if ((HISTORIC_VERSIONS as readonly string[]).includes(header)) return { version: OLDEST_ACTIVE };
  return { error: `X-JOBBER-GRAPHQL-VERSION "${header}" is not a Jobber API version. ${supported}` };
}
