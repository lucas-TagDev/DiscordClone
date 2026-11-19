import { NextRequest, NextResponse } from "next/server";
import { getApiErrorStatus, requireAuthenticatedUserId, sanitizeChatMessageForApi } from "@/lib/api-auth";
import { getMessageContext } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: {
  params: Promise<{ serverId: string; channelId: string; messageId: string }>;
}) {
  try {
    const userId = requireAuthenticatedUserId(request);
    const { serverId, channelId, messageId } = await params;
    const page = await getMessageContext(serverId, channelId, userId, messageId);
    return NextResponse.json({ ...page, messages: page.messages.map(sanitizeChatMessageForApi) }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao abrir mensagem." },
      { status: getApiErrorStatus(error) });
  }
}
