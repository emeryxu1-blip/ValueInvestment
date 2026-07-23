import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// The application does not use ISR today, so no R2/KV incremental cache is
// needed. D1 remains the durable store for user workspace data.
export default defineCloudflareConfig();
