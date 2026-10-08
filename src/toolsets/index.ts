import type { AnyToolSpec } from "../core/registry.js";
import { coreTools } from "./core.js";
import { actionTools } from "./actions.js";
import { inspectionsTools } from "./inspections.js";
import { templatesTools } from "./templates.js";
import { issuesTools } from "./issues.js";
import { investigationsTools } from "./investigations.js";
import { assetsTools } from "./assets.js";
import { sitesTools } from "./sites.js";
import { peopleTools } from "./people.js";
import { schedulesTools } from "./schedules.js";
import { trainingTools } from "./training.js";
import { headsupTools } from "./headsup.js";
import { contractorsTools } from "./contractors.js";
import { documentsTools } from "./documents.js";
import { sensorsTools } from "./sensors.js";
import { webhooksTools } from "./webhooks.js";
import { feedsTools } from "./feeds.js";
import { analyticsTools } from "./analytics.js";
import { reportsTools } from "./reports.js";
import { integrationsTools } from "./integrations.js";

/** Every tool the server knows. Selection by mode and toolset happens in core/registry.ts. */
export const ALL_TOOLS: AnyToolSpec[] = [
  ...coreTools,
  ...inspectionsTools,
  ...templatesTools,
  ...actionTools,
  ...issuesTools,
  ...investigationsTools,
  ...assetsTools,
  ...sitesTools,
  ...peopleTools,
  ...schedulesTools,
  ...trainingTools,
  ...headsupTools,
  ...contractorsTools,
  ...documentsTools,
  ...sensorsTools,
  ...webhooksTools,
  ...feedsTools,
  ...analyticsTools,
  ...reportsTools,
  ...integrationsTools,
];
