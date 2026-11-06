/**
 * The company's own calendar day for a Jobber date-time, which is how QuickBooks dates a transaction.
 *
 * QuickBooks keeps a company's books in its time zone: a transaction created without a TxnDate is dated "the current
 * date on the server" for that company (https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice),
 * and the bookkeeper dates by the same calendar. Jobber sends issuedDate and dueDate as UTC date-times ("...Z"), so the
 * date part of an invoice issued at 8 p.m. in Texas is already tomorrow. Booked as written, it would land a day later
 * than the bookkeeper would book it, and a month-end invoice in the wrong month.
 *
 * Jobber's Account gives only its id and name, and the twin doesn't serve QuickBooks' CompanyInfo, so the sync is
 * told the zone: an IANA name ("America/Chicago") you save when the business connects. Intl handles daylight saving.
 */
export function companyDayIn(timeZone: string): (dateTime: string) => string {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    throw new Error(`"${timeZone}" isn't a time zone this runtime knows. Pass the company's IANA zone, like "America/Chicago".`);
  }
  return (dateTime) => {
    const parts = Object.fromEntries(format.formatToParts(new Date(dateTime)).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
}
