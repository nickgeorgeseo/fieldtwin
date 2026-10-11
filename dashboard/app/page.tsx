import { ActionsPanel } from "@/components/actions-panel.tsx";
import { AuthPanel } from "@/components/auth-panel.tsx";
import { CheckpointsPanel } from "@/components/checkpoints-panel.tsx";
import { ClockPanel } from "@/components/clock-panel.tsx";
import { FaultsPanel } from "@/components/faults-panel.tsx";
import { PageTitle } from "@/components/page-title.tsx";
import { ScenarioPanel } from "@/components/scenario-panel.tsx";
import { StatusPanel } from "@/components/status-panel.tsx";
import { WebhooksPanel } from "@/components/webhooks-panel.tsx";

export default function ControlRoom() {
  return (
    <>
      <PageTitle title="Control room">
        Everything here goes through the twin's control plane, as <code className="font-mono">curl</code> to{" "}
        <code className="font-mono">/_twin</code> would. Your code still talks to the vendor APIs at the twin's address.
      </PageTitle>
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <StatusPanel />
          <CheckpointsPanel />
          <div className="grid items-start gap-6 sm:grid-cols-2">
            <ActionsPanel />
            <AuthPanel />
          </div>
        </div>
        <div className="space-y-6">
          <ClockPanel />
          <ScenarioPanel />
          <FaultsPanel />
        </div>
        <div className="lg:col-span-3">
          <WebhooksPanel />
        </div>
      </div>
    </>
  );
}
