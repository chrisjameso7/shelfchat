// Operator-only review tool. Never accepts a secret as a command-line argument.
import { parseArgs } from "node:util";
const { values } = parseArgs({
  options: {
    action: { type: "string", default: "queue" },
    id: { type: "string" },
    note: { type: "string" },
    "rights-reviewed": { type: "boolean" },
  },
});
const token = process.env.SHELFCHAT_IMPORT_TOKEN,
  base = process.env.SHELFCHAT_IMPORT_ENDPOINT;
if (!token || !base) throw Error("Load the private operator environment file.");
const endpoint = new URL("/api/admin/moderation", base);
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    action: values.action,
    id: values.id,
    note: values.note,
    rightsReviewed: !!values["rights-reviewed"],
  }),
  signal: AbortSignal.timeout(55000),
});
const result = await response.json();
if (!response.ok) throw Error(result.error || "Moderation failed");
console.log(JSON.stringify(result, null, 2));
