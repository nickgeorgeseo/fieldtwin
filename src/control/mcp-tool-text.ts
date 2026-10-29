import type { Twin } from "../core/twin.ts";

/**
 * What each MCP tool tells a coding agent: a title, and a description saying what it does, what it leaves alone, and
 * what it answers. Each vendor's actions and topics come from the vendors themselves, so a new vendor needs no edit here.
 */
export function toolText(twin: Twin) {
  return {
    twin_status: {
      title: "Twin status",
      description:
        "Where the test world stands: company, seed, loaded scenario, twin time, event count, auth mode, active faults, " +
        "checkpoints, and the timeline entries due next. Changes nothing. Call it first to get your bearings.",
    },
    twin_reset: {
      title: "Reset the twin",
      description:
        "Throw away everything since the start and rebuild the seeded world (the loaded scenario's, if one is loaded), with " +
        "its timeline and faults. Checkpoints go too; webhook subscriptions and the auth mode stay. To undo only part of a " +
        "run, use twin_rewind. Answers with the new status.",
    },
    twin_advance_clock: {
      title: "Move twin time forward",
      description:
        "Twin time stands still until you move it. Scheduled scenario events happen on the way, each at its own time, and " +
        "the webhooks they cause are delivered to the subscribed URLs before this answers; 0 minutes only sends deliveries " +
        "already due. Answers with the new twin time and how many scenario events happened.",
    },
    twin_run_action: {
      title: "Make something happen in a vendor's app",
      description:
        `Make something happen now, as if someone did it in the vendor's own app: ${actionsByVendor(twin)}. ` +
        'Each takes params: how many. Recorded with source "control"; its webhooks are delivered before this answers. ' +
        "Answers with the events it recorded.",
    },
    twin_checkpoint: {
      title: "Take a checkpoint",
      description:
        "Name the current moment (log position, twin time, and fault dice), to list changes since it with twin_changes " +
        "or go back to it with twin_rewind. A name already taken moves to now. Answers with the checkpoint.",
    },
    twin_changes: {
      title: "List changes since a checkpoint",
      description:
        "What changed since a checkpoint, one line per event, oldest first: when, which vendor, what, and its source. " +
        "Set onlyFromApi to see only what your code's API calls did. Changes nothing. For whole events, use twin_export_log.",
    },
    twin_rewind: {
      title: "Rewind to a checkpoint",
      description:
        "Undo everything recorded after a checkpoint: records, twin time, and fault dice go back, so the same requests meet " +
        "the same faults again. Checkpoints taken after it are dropped. Answers with the new status.",
    },
    twin_list_scenarios: {
      title: "List ready-made scenarios",
      description: "The ready-made scenarios twin_load_scenario can load by name, and what each one tests. Changes nothing.",
    },
    twin_load_scenario: {
      title: "Load a scenario",
      description:
        "Throw away the current world and build one from a scenario: a ready-made one by name (see twin_list_scenarios), " +
        "or your own YAML (seed, startTime, world, faults, auth, timeline). Give one of the two. A scenario that doesn't " +
        "load leaves the twin as it was. twin_reset comes back to its start. Answers with the new status.",
    },
    twin_set_faults: {
      title: "Set fault rules",
      description:
        "Replace the active fault rules, so the vendor APIs fail the way real ones do. Each rule: { name, vendor: " +
        `${twin.vendorNames().join("|")}, method?, pathIncludes?, pathExcludes?, rate: 0-1, effect: { status?: HTTP error ` +
        "status, latencyMs?, message?, lostResponse?: do the work, then answer with status } }. A rule with webhook: TOPIC " +
        'or "*" (and no method, pathIncludes, or pathExcludes) affects webhook deliveries instead: effect { duplicate?: true, ' +
        "delayMs? }. An empty list turns faults off. Bad rules change nothing. Answers with the active rules' names.",
    },
    twin_set_auth: {
      title: "Set the auth mode",
      description:
        'How the vendor APIs treat bearer tokens: "any-token" accepts anything; "oauth" accepts only unexpired tokens ' +
        "from the twin's OAuth endpoints. Changes no records. Answers with the mode.",
    },
    twin_set_webhooks: {
      title: "Set webhook subscriptions",
      description:
        "Replace the webhook subscriptions, as an app would set them up in the vendor's developer settings. Each: " +
        `{ vendor: ${twin.vendorNames().join(" | ")}, url, topics, clientId, clientSecret (signs deliveries: for Jobber the app's OAuth ` +
        `client secret, for QuickBooks its verifier token, for Housecall Pro its signing secret) }. ${topicsByVendor(twin)}. ` +
        "Answers as twin_webhooks does.",
    },
    twin_webhooks: {
      title: "Show webhooks",
      description: "The webhook subscriptions, without their secrets, and the latest deliveries with how each went. Changes nothing.",
    },
    twin_export_log: {
      title: "Export the event log",
      description:
        "The event log as JSON Lines, one whole event per line, oldest first: everything, or only what happened since a " +
        "checkpoint. Changes nothing. For a one-line summary of each, use twin_changes.",
    },
  };
}

/** "jobber newClients or payInvoices; housecallpro newCustomers, completeJobs, invoiceJobs, or payInvoices (quickbooks has none)" */
function actionsByVendor(twin: Twin): string {
  const actions = twin.vendorNames().map((name) => [name, Object.keys(twin.vendor(name).scenarioActions ?? {})] as const);
  const listed = actions.filter(([, names]) => names.length).map(([name, names]) => `${name} ${oneOf(names)}`);
  const without = actions.filter(([, names]) => !names.length).map(([name]) => name);
  return without.length ? `${listed.join("; ")} (${oneOf(without)} has none)` : listed.join("; ");
}

/** "jobber topics: CLIENT_CREATE, INVOICE_UPDATE. quickbooks topics: qbo.customer.created.v1, ..." */
function topicsByVendor(twin: Twin): string {
  return twin
    .vendorNames()
    .map((name) => `${name} topics: ${twin.vendor(name).webhooks?.topics.join(", ") || "none yet"}`)
    .join(". ");
}

/** "a", "a or b", "a, b, or c" */
export function oneOf(names: string[]): string {
  return names.length <= 2 ? names.join(" or ") : `${names.slice(0, -1).join(", ")}, or ${names.at(-1)}`;
}
