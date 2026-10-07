#!/usr/bin/env node

/**
 * Script para promover um usuário a administrador
 * Uso: npm run promote-admin -- <username>
 */

const { PrismaClient } = require("@prisma/client");

async function main() {
  const username = process.argv[2]?.toLowerCase();

  if (!username) {
    console.error("❌ Erro: Username não fornecido");
    console.log("Uso: npm run promote-admin -- <username>");
    process.exit(1);
  }

  const db = new PrismaClient();

  try {
    const user = await db.user.findUnique({
      where: { username },
      select: { id: true, username: true, displayName: true, isAdmin: true },
    });

    if (!user) {
      console.error(`❌ Erro: Usuário "${username}" não encontrado`);
      process.exit(1);
    }

    if (user.isAdmin) {
      console.log(`ℹ️  Usuário "${username}" já é administrador`);
      process.exit(0);
    }

    await db.user.update({
      where: { id: user.id },
      data: { isAdmin: true },
    });

    console.log(`✅ Usuário "${username}" promovido a administrador com sucesso!`);
    console.log(`📱 Acesse o painel em: http://localhost:3000/admin`);
  } catch (error) {
    console.error("❌ Erro:", error);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

main();

