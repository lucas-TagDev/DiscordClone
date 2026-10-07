/**
 * Script de migração para atualizar caminhos de upload legados
 * 
 * Este script atualiza os caminhos de arquivos de upload que estavam em:
 * - /avatars/* → /uploads/avatars/*
 * - /server-avatars/* → /uploads/server-avatars/*
 * - /server-banners/* → /uploads/server-banners/*
 * 
 * USO:
 *   npx tsx scripts/migrate-upload-paths.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function migrateUploadPaths() {
  console.log("🔄 Iniciando migração de caminhos de upload...\n");

  try {
    // Migrar avatares de usuários - /avatars/* → /uploads/avatars/*
    const usersWithLegacyAvatars = await prisma.user.findMany({
      where: {
        avatarUrl: { startsWith: "/avatars/" },
      },
      select: { id: true, avatarUrl: true, displayName: true },
    });

    console.log(`📌 Encontrados ${usersWithLegacyAvatars.length} usuários com avatares no caminho antigo (/avatars/)`);

    for (const user of usersWithLegacyAvatars) {
      if (!user.avatarUrl) continue;
      
      const newAvatarUrl = user.avatarUrl.replace(/^\/avatars\//, "/uploads/avatars/");
      
      await prisma.user.update({
        where: { id: user.id },
        data: { avatarUrl: newAvatarUrl },
      });

      console.log(`  ✅ ${user.displayName}: ${user.avatarUrl} → ${newAvatarUrl}`);
    }

    console.log();

    // Migrar avatares de servidores - /server-avatars/* → /uploads/server-avatars/*
    const serversWithLegacyAvatars = await prisma.server.findMany({
      where: {
        avatarUrl: { startsWith: "/server-avatars/" },
      },
      select: { id: true, avatarUrl: true, name: true },
    });

    console.log(`📌 Encontrados ${serversWithLegacyAvatars.length} servidores com avatares no caminho antigo (/server-avatars/)`);

    for (const server of serversWithLegacyAvatars) {
      if (!server.avatarUrl) continue;

      const newAvatarUrl = server.avatarUrl.replace(/^\/server-avatars\//, "/uploads/server-avatars/");

      await prisma.server.update({
        where: { id: server.id },
        data: { avatarUrl: newAvatarUrl },
      });

      console.log(`  ✅ ${server.name}: ${server.avatarUrl} → ${newAvatarUrl}`);
    }

    console.log();

    // Migrar banners de servidores - /server-banners/* → /uploads/server-banners/*
    const serversWithLegacyBanners = await prisma.server.findMany({
      where: {
        serverBannerUrl: { startsWith: "/server-banners/" },
      },
      select: { id: true, serverBannerUrl: true, name: true },
    });

    console.log(`📌 Encontrados ${serversWithLegacyBanners.length} servidores com banners no caminho antigo (/server-banners/)`);

    for (const server of serversWithLegacyBanners) {
      if (!server.serverBannerUrl) continue;

      const newBannerUrl = server.serverBannerUrl.replace(/^\/server-banners\//, "/uploads/server-banners/");

      await prisma.server.update({
        where: { id: server.id },
        data: { serverBannerUrl: newBannerUrl },
      });

      console.log(`  ✅ ${server.name}: ${server.serverBannerUrl} → ${newBannerUrl}`);
    }

    console.log();

    const totalUpdated = usersWithLegacyAvatars.length + serversWithLegacyAvatars.length + serversWithLegacyBanners.length;
    console.log(`✨ Migração concluída! ${totalUpdated} registros atualizados.`);
    console.log("\n⚠️  IMPORTANTE: Limpe o sessionStorage dos usuários para forçar recarregamento dos novos caminhos:");
    console.log("   window.sessionStorage.clear()");

  } catch (error) {
    console.error("❌ Erro durante a migração:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

migrateUploadPaths();
