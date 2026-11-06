import { housecallpro, jobber, quickbooks, refuseUnrecordable, type Target, type Vendor } from "./case.ts";
import { withoutCredentials } from "./run.ts";

/**
 * Before recording anything, make sure each sandbox accepts its token and its URL is right. Tokens last an hour,
 * and a recording made with a dead one is 401s from start to finish: committed, it would fail every case as if the
 * twin were wrong. A vendor throttling or down says nothing about either, so the check says to try again later
 * rather than send anyone off to change settings that are right.
 */
export async function checkTokens(target: Target, vendors: Vendor[]): Promise<void> {
  if (vendors.includes("quickbooks")) {
    const answer = await reach(
      quickbooks(target, "GET", `companyinfo/${target.quickbooks.realmId}`, undefined, { anyAnswer: true }),
      "QuickBooks",
      target,
      target.quickbooks.apiBase,
    );
    refuseUnrecordable("QuickBooks", answer, false);
    const { status } = answer;
    if (status === 401 || status === 403) {
      throw new Error(
        `QuickBooks refused QBO_ACCESS_TOKEN (HTTP ${status}). Access tokens last an hour: get a fresh one, for the sandbox company in QBO_REALM_ID.`,
      );
    }
    // A 200 alone could be a dev server or a proxy that answers everything: QuickBooks answers with the CompanyInfo.
    // https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/companyinfo
    if (status !== 200 || typeof answer.body?.CompanyInfo !== "object" || answer.body.CompanyInfo === null) {
      throw new Error(
        `QuickBooks didn't answer reading CompanyInfo with the company (HTTP ${status}). Check QBO_API_BASE (${target.quickbooks.apiBase}) and QBO_REALM_ID.`,
      );
    }
  }
  if (vendors.includes("jobber")) {
    const answer = await reach(jobber(target, "{ account { id } }", { anyAnswer: true }), "Jobber", target, target.jobber.apiUrl);
    refuseUnrecordable("Jobber", answer, false);
    if (answer.status === 401 || answer.status === 403) {
      throw new Error(`Jobber refused JOBBER_ACCESS_TOKEN (HTTP ${answer.status}). Access tokens last an hour: get a fresh one.`);
    }
    if (!answer.body?.data?.account) {
      throw new Error(`Jobber didn't answer { account { id } } (HTTP ${answer.status}). Check JOBBER_API_URL (${target.jobber.apiUrl}).`);
    }
  }
  if (vendors.includes("housecallpro")) {
    // "This API is available to any Pro on the MAX or XL Plan": https://docs.housecallpro.com/
    const { apiBase } = target.housecallpro;
    const answer = await reach(housecallpro(target, "GET", "/company", undefined, { anyAnswer: true }), "Housecall Pro", target, apiBase);
    refuseUnrecordable("Housecall Pro", answer, false);
    if (answer.status === 401 || answer.status === 403) {
      throw new Error(
        `Housecall Pro refused HOUSECALLPRO_API_KEY (HTTP ${answer.status}). Use one of the account's API keys: the API is for Pros on the MAX or XL plan.`,
      );
    }
    if (answer.status !== 200 || typeof answer.body?.id !== "string") {
      throw new Error(
        `Housecall Pro didn't answer GET /company with a company (HTTP ${answer.status}). Check HOUSECALLPRO_API_URL (${apiBase}).`,
      );
    }
  }
}

/** The answer, or an error naming the URL that couldn't be reached at all, and never the target's credentials. */
function reach<T>(answer: Promise<T>, vendor: string, target: Target, url: string): Promise<T> {
  return answer.catch((error: Error) => {
    const why = withoutCredentials(target, error.message);
    throw new Error(`Couldn't reach ${vendor} at ${url} (${why}). Check the URL and your connection.`);
  });
}
