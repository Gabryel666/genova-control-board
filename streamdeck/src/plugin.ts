/**
 * Genova Control Board — plugin entry point.
 *
 * Global settings (gateway URL + optional token) are shared by every key, so a
 * single configuration covers the whole board. They are read from the property
 * inspector of any key (`global` attribute in the sdpi fields).
 */

import streamDeck from "@elgato/streamdeck";

import { StatusAction } from "./actions/status.js";
import { ModelAction } from "./actions/model.js";
import { CronAction } from "./actions/cron.js";
import { MetricAction } from "./actions/metric.js";
import { setGlobalConfig } from "./lib/gateway.js";
import { diag } from "./lib/diag.js";

streamDeck.actions.registerAction(new StatusAction());
streamDeck.actions.registerAction(new ModelAction());
streamDeck.actions.registerAction(new CronAction());
streamDeck.actions.registerAction(new MetricAction());

streamDeck.settings.onDidReceiveGlobalSettings((ev) => {
  setGlobalConfig(ev.settings as { baseUrl?: string; token?: string });
});

streamDeck.settings
  .getGlobalSettings<{ baseUrl?: string; token?: string }>()
  .then((settings) => setGlobalConfig(settings))
  .catch((err) => diag(`global settings: ${(err as Error).message}`));

streamDeck.connect();
