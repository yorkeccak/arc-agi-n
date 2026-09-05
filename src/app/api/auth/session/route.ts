import { NextResponse } from "next/server";
import { clearValyuSession, getValyuUser } from "@/lib/valyu-session";

const privateResponse = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" };

export async function GET() {
  const user = await getValyuUser();
  if (!user) await clearValyuSession();
  return NextResponse.json({ user: user || null }, { headers: privateResponse });
}

export async function DELETE() {
  await clearValyuSession();
  return NextResponse.json({ ok: true }, { headers: privateResponse });
}
