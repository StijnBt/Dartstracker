import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "../lib/prisma";

export async function health(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  try {
    await prisma.$queryRaw`SELECT 1 as ok`;
    return { status: 200, jsonBody: { status: "ok", dbConnected: true } };
  } catch (error) {
    context.error(`Database connectivity check failed: ${error}`);
    return { status: 500, jsonBody: { status: "error", dbConnected: false } };
  }
}

app.http("health", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "health",
  handler: health,
});
