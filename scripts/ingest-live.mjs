#!/usr/bin/env node
/** Off-Vercel live ingest. Reads TWITTERAPI_IO_KEY from the environment only.
 * Never logs the key. No-ops (seed stays) when the key is unset.
 */
import { runIngest } from "../lib/ingest.js";

function publicResult(result) {
  const out = { ...result };
  delete out.apiKey;
  delete out.key;
  delete out.headers;
  return out;
}

const result = await runIngest({
  now: new Date(),
  env: process.env,
  writeFiles: true,
});
console.log(JSON.stringify(publicResult(result)));
