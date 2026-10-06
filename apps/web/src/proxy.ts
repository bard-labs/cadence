import { type NextRequest, NextResponse } from "next/server";

import { safeNext } from "@/lib/redirect";

// Must match services/core/internal/auth.CookieName.
const SESSION_COOKIE = "cadence_session";

/**
 * Login gate. This only checks that a session cookie exists, which is enough to
 * pick the right first screen. The API validates the session on every request
 * and clears the cookie on 401, so a stale cookie cannot cause a redirect loop.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const isLogin = pathname === "/login";

  if (!hasSession && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  if (hasSession && isLogin) {
    return NextResponse.redirect(new URL(safeNext(request.nextUrl.searchParams.get("next")), request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)"],
};
