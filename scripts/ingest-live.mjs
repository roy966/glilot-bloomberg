#!/usr/bin/env node
/** Off-Vercel live ingest: X (needs TWITTERAPI_IO_KEY) + Substack public RSS (no key).
 * Never logs secrets. X is skipped when the key is unset; Substack still runs.
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
