import { EventFeed } from "@/components/event-feed.tsx";
import { PageTitle } from "@/components/page-title.tsx";

export const metadata = { title: "Events · fieldtwin dashboard" };

export default function Events() {
  return (
    <>
      <PageTitle title="Events">
        Everything that happens in the twin, newest first: your code's API calls, the scenario's timeline, the control plane, and the seeded
        history. Each event carries the whole record it changed; open one to see it.
      </PageTitle>
      <EventFeed />
    </>
  );
}
