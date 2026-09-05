export function validatePaidRequest(request: Request): Response | undefined {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
  }
}
