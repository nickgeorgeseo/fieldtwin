/** Where the twin is: FIELDTWIN_URL, as for the reference integration, or where `npm start` puts it. */
export function twinUrl(): string {
  return (process.env.FIELDTWIN_URL ?? "http://localhost:4010").replace(/\/+$/, "");
}
