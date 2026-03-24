import { NextResponse } from "next/server";
import { removePasskey } from "@/lib/auth-store";

export async function DELETE(request: Request) {
  const { id } = await request.json();

  if (!id) {
    return NextResponse.json({ error: "Passkey ID required" }, { status: 400 });
  }

  removePasskey(id);
  return NextResponse.json({ success: true });
}
