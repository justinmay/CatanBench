import { getGameStateHttp } from "@catanbench/api/http";

import { getAgentApi } from "@/server/agent-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const { gameId } = await params;
  return getGameStateHttp(getAgentApi(), request, gameId);
}
