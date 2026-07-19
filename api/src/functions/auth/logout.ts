import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { AUTH_COOKIE_NAME } from "../../lib/jwt";

export async function logout(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const secure = request.url.startsWith("https://");
  return {
    status: 200,
    jsonBody: { success: true },
    cookies: [
      {
        name: AUTH_COOKIE_NAME,
        value: "",
        httpOnly: true,
        secure,
        sameSite: "Lax",
        path: "/",
        maxAge: 0,
      },
    ],
  };
}

app.http("authLogout", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "auth/logout",
  handler: logout,
});
