import { jobber, quickbooks, type Target } from "./case.ts";

/**
 * Before recording anything, make sure each sandbox accepts its token and its URL is right. Tokens last an hour,
 * and a recording made with a dead one is 401s from start to finish: committed, it would fail every case as if the
 * twin were wrong.
 */
export async function checkTokens(target: Target, vendors: ("quickbooks" | "jobber")[]): Promise<void> {
  if (vendors.includes("quickbooks")) {
    const { status } = await reach(
      quickbooks(target, "GET", `companyinfo/${target.quickbooks.realmId}`),
      "QuickBooks",
      target.quickbooks.apiBase,
    );
    if (status === 401 || status === 403) {
      throw new Error(
        `QuickBooks refused QBO_ACCESS_TOKEN (HTTP ${status}). Access tokens last an hour: get a fresh one, for the sandbox company in QBO_REALM_ID.`,
      );
    }
    if (status !== 200) {
      throw new Error(
        `QuickBooks answered HTTP ${status} to reading CompanyInfo. Check QBO_API_BASE (${target.quickbooks.apiBase}) and QBO_REALM_ID.`,
      );
    }
  }
  if (vendors.includes("jobber")) {
    const answer = await reach(jobber(target, "{ account { id } }"), "Jobber", target.jobber.apiUrl);
    if (answer.status === 401 || answer.status === 403) {
      throw new Error(`Jobber refused JOBBER_ACCESS_TOKEN (HTTP ${answer.status}). Access tokens last an hour: get a fresh one.`);
    }
    if (!answer.body?.data?.account) {
      throw new Error(`Jobber didn't answer { account { id } } (HTTP ${answer.status}). Check JOBBER_API_URL (${target.jobber.apiUrl}).`);
    }
  }
}

/** The answer, or an error naming the URL that couldn't be reached at all. */
function reach<T>(answer: Promise<T>, vendor: string, url: string): Promise<T> {
  return answer.catch((error: Error) => {
    throw new Error(`Couldn't reach ${vendor} at ${url} (${error.message}). Check the URL and your connection.`);
  });
}
