import { BusinessView } from "@/components/business-view.tsx";
import { PageTitle } from "@/components/page-title.tsx";

export const metadata = { title: "Business · fieldtwin dashboard" };

export default function Business() {
  return (
    <>
      <PageTitle title="Business">
        The same business as QuickBooks and a field-service system, Jobber or Housecall Pro, each have it now, rebuilt from the twin's event
        log, so looking changes nothing: no rate limits spent, no faults drawn. Red is what a sync still has to do. Load mismatched-books to
        see the systems disagree.
      </PageTitle>
      <BusinessView />
    </>
  );
}
