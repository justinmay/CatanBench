export const dynamic = "force-static";

export function GET() {
  return Response.json({
    service: "catanbench-web",
    status: "ok",
    apiVersion: "v1",
  });
}
