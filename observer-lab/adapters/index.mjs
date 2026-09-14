import * as application from "./application/index.mjs";
import * as browser from "./browser/index.mjs";
import * as clipboard from "./clipboard/index.mjs";
import * as database from "./database/index.mjs";
import * as desktop from "./desktop/index.mjs";
import * as externalApi from "./external-api/index.mjs";
import * as filesystem from "./filesystem/index.mjs";
import * as network from "./network/index.mjs";
import * as processObserver from "./process/index.mjs";
import * as system from "./system/index.mjs";

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
