/**
 * Where each vendor lives.
 *
 * QuickBooks: https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
 *             https://developer.intuit.com/app/developer/qbo/docs/learn/rest-api-features
 * Jobber:     https://developer.getjobber.com/docs/building_your_app/app_authorization/
 *             https://developer.getjobber.com/docs/using_jobbers_api/api_queries_and_mutations/
 *
 * A fieldtwin twin serves every one of these paths on a single base URL, so pointing the integration at a
 * twin is endpointsAt("http://localhost:4010") and nothing else changes.
 */
export interface Endpoints {
  quickbooks: { authorizeUrl: string; tokenUrl: string; apiBase: string };
  jobber: { authorizeUrl: string; tokenUrl: string; apiUrl: string };
}

export const VENDOR_ENDPOINTS: Endpoints = {
  quickbooks: {
    authorizeUrl: "https://appcenter.intuit.com/connect/oauth2",
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    apiBase: "https://quickbooks.api.intuit.com", // followed by /v3/company/{realmId}/...
  },
  jobber: {
    authorizeUrl: "https://api.getjobber.com/api/oauth/authorize",
    tokenUrl: "https://api.getjobber.com/api/oauth/token",
    apiUrl: "https://api.getjobber.com/api/graphql",
  },
};

/** The same endpoints, served from one base URL (a twin). */
export function endpointsAt(baseUrl: string): Endpoints {
  const base = baseUrl.replace(/\/+$/, "");
  const at = (url: string) => base + new URL(url).pathname.replace(/\/+$/, "");
  const { quickbooks, jobber } = VENDOR_ENDPOINTS;
  return {
    quickbooks: { authorizeUrl: at(quickbooks.authorizeUrl), tokenUrl: at(quickbooks.tokenUrl), apiBase: at(quickbooks.apiBase) },
    jobber: { authorizeUrl: at(jobber.authorizeUrl), tokenUrl: at(jobber.tokenUrl), apiUrl: at(jobber.apiUrl) },
  };
}
