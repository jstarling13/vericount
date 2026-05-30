import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/connect-qbo(.*)",        // welcome-email link — visited before the client has a portal account
  "/pending(.*)",            // shown when a Clerk user has no matching DB record
  "/api/qbo/callback(.*)",         // OAuth callback — must be reachable before sign-in
  "/api/qbo/connect(.*)",          // OAuth initiation — called from connect-qbo page
  "/api/webhooks(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
