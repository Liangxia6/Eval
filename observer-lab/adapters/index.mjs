import * as application from "./application.mjs";
import * as browser from "./browser.mjs";
import * as clipboard from "./clipboard.mjs";
import * as database from "./database.mjs";
import * as desktop from "./desktop.mjs";
import * as externalApi from "./external-api.mjs";
import * as filesystem from "./filesystem.mjs";
import * as network from "./network.mjs";
import * as processObserver from "./process.mjs";
import * as system from "./system.mjs";

export const adapters = Object.freeze({
  application,
  browser,
  clipboard,
  database,
  desktop,
  "external-api": externalApi,
  filesystem,
  network,
  process: processObserver,
  system,
});
