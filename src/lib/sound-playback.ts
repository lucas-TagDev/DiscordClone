/**
 * Registra que um usuário tocou um áudio
 * @param soundId - ID do áudio
 * @param serverId - ID do servidor
 * @returns Dados do playback registrado
 */
export async function recordSoundPlayback(soundId: string, serverId: string) {
  try {
    const response = await fetch(
      `/api/servers/${serverId}/sounds/${soundId}/playback`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId }),
      }
    );

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Falha ao registrar playback");
    }

    return await response.json();
  } catch (error) {
    console.error("Erro ao registrar playback:", error);
    throw error;
  }
}

/**
 * Busca o histórico de quem tocou um áudio
 * @param soundId - ID do áudio
 * @param limit - Número máximo de registros (padrão: 50, máximo: 100)
 * @param offset - Deslocamento para paginação
 * @returns Lista de playbacks com usuários
 */
export async function getSoundPlaybackHistory(
  soundId: string,
  limit: number = 50,
  offset: number = 0
) {
  try {
    const params = new URLSearchParams({
      limit: Math.min(100, limit).toString(),
      offset: Math.max(0, offset).toString(),
    });

    const response = await fetch(
      `/api/servers/[serverId]/sounds/${soundId}/playback-history?${params}`,
      {
        method: "GET",
      }
    );

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "Falha ao buscar histórico");
    }

    return await response.json();
  } catch (error) {
    console.error("Erro ao buscar histórico:", error);
    throw error;
  }
}
