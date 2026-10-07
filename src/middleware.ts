import { NextRequest, NextResponse } from "next/server";

const isDirectBrowserNavigationToApi = (request: NextRequest): boolean => {
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return false;
  }

  const mode = (request.headers.get("sec-fetch-mode") ?? "").toLowerCase();
  const dest = (request.headers.get("sec-fetch-dest") ?? "").toLowerCase();
  const accept = (request.headers.get("accept") ?? "").toLowerCase();

  return mode === "navigate" || dest === "document" || accept.includes("text/html");
};

export function middleware(request: NextRequest) {
  if (isDirectBrowserNavigationToApi(request)) {
    return new NextResponse("", {
      status: 404,
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
