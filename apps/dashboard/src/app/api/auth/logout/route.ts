import { NextResponse } from "next/server";

export async function POST() {
  const res = NextResponse.redirect(new URL("/login", process.env.DASHBOARD_URL!));
  res.cookies.delete("dashboard_auth");
  return res;
}
