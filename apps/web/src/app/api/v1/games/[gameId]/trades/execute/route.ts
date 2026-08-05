import { executeTradeHttp } from "@catanbench/api/http";

import { getAgentApi } from "@/server/agent-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const { gameId } = await params;
  return executeTradeHttp(getAgentApi(), request, gameId);
}
