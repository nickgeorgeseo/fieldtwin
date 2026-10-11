import { ActionsPanel } from "@/components/actions-panel.tsx";
import { AuthPanel } from "@/components/auth-panel.tsx";
import { ClockPanel } from "@/components/clock-panel.tsx";
import { PageTitle } from "@/components/page-title.tsx";
import { ScenarioPanel } from "@/components/scenario-panel.tsx";
import { StatusPanel } from "@/components/status-panel.tsx";

export default function ControlRoom() {
  return (
    <>
      <PageTitle title="Control room">
        Everything here goes through the twin's control plane, as <code className="font-mono">curl</code> to{" "}
        <code className="font-mono">/_twin</code> would. Your code still talks to the vendor APIs at the twin's address.
      </PageTitle>
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <StatusPanel />
        <ClockPanel />
        <ScenarioPanel />
        <ActionsPanel />
        <AuthPanel />
      </div>
    </>
  );
}
