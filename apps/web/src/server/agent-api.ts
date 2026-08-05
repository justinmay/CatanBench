import { AgentApi } from "@catanbench/api";
import { createDatabase } from "@catanbench/db";

declare global {
  var catanbenchAgentApi: AgentApi | undefined;
}

export function getAgentApi(): AgentApi {
  if (!globalThis.catanbenchAgentApi) {
    const { pool } = createDatabase({ max: 10 });
    globalThis.catanbenchAgentApi = new AgentApi(pool);
  }
  return globalThis.catanbenchAgentApi;
}
