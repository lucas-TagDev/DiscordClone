import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile, readdir, unlink, stat, rename } from "node:fs/promises";
import { createWriteStream, createReadStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requireAuthenticatedUserId } from "@/lib/api-auth";

const getMaxFileSizeBytes = (): number => {
  const rawValue = process.env.CHANNEL_UPLOAD_MAX_FILE_SIZE_MB ?? process.env.NEXT_PUBLIC_CHANNEL_UPLOAD_MAX_FILE_SIZE_MB;
  const parsedMb = Number(rawValue);
  if (!Number.isFinite(parsedMb) || parsedMb <= 0) {
    return 50 * 1024 * 1024;
  }
  return Math.floor(parsedMb * 1024 * 1024);
};

const MAX_FILE_SIZE = getMaxFileSizeBytes();

const sanitizeFileName = (name: string): string =>
  name
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 120) || "arquivo";

// POST /api/upload?dir=channels|direct
//
// Chunked upload:
//   Query params: uploadId, chunk (0-based index), totalChunks, filename
//   Body: raw binary chunk data
//   - Each chunk is saved to a temp folder
//   - On the last chunk, all are assembled into the final file
//
// Single file upload (backward compat):
//   Headers: x-filename (original filename)
//   Body: raw binary file content

export async function POST(request: NextRequest) {
  try {
    requireAuthenticatedUserId(request);

    const subDir = request.nextUrl.searchParams.get("dir") === "direct" ? "direct" : "channels";
    const uploadId = request.nextUrl.searchParams.get("uploadId");
    const chunkIndex = request.nextUrl.searchParams.get("chunk");
    const totalChunksParam = request.nextUrl.searchParams.get("totalChunks");
    const filenameParam = request.nextUrl.searchParams.get("filename");

    // --- Chunked upload ---
    if (uploadId && chunkIndex !== null && totalChunksParam) {
      const chunk = Number(chunkIndex);
      const totalChunks = Number(totalChunksParam);
      const fileName = decodeURIComponent(filenameParam || "arquivo");

      if (!Number.isInteger(chunk) || !Number.isInteger(totalChunks) || chunk < 0 || totalChunks <= 0 || chunk >= totalChunks) {
        return NextResponse.json({ error: "Parâmetros de chunk inválidos." }, { status: 400 });
      }

      // Validate uploadId format (prevent path traversal)
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(uploadId)) {
        return NextResponse.json({ error: "uploadId inválido." }, { status: 400 });
      }

      const tempDir = path.join(process.cwd(), "public", "uploads", ".tmp", uploadId);
      await mkdir(tempDir, { recursive: true });

      const body = request.body;
      if (!body) {
        return NextResponse.json({ error: "Corpo da requisição vazio." }, { status: 400 });
      }

      // Save this chunk to disk
      const chunkPath = path.join(tempDir, `chunk-${String(chunk).padStart(5, "0")}`);
      const writer = createWriteStream(chunkPath);
      const reader = body.getReader();
      let chunkSize = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunkSize += value.byteLength;
          const ok = writer.write(Buffer.from(value));
          if (!ok) {
            await new Promise<void>((resolve) => writer.once("drain", resolve));
          }
        }
      } finally {
        writer.end();
      }

      await new Promise<void>((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      // Check if all chunks have arrived
      const chunkFiles = (await readdir(tempDir)).filter((f) => f.startsWith("chunk-")).sort();

      if (chunkFiles.length < totalChunks) {
        // Not all chunks yet — acknowledge this one
        return NextResponse.json({
          status: "chunk_received",
          chunk,
          received: chunkFiles.length,
          totalChunks,
        });
      }

      // All chunks received — assemble final file
      const uploadsDir = path.join(process.cwd(), "public", "uploads", subDir);
      await mkdir(uploadsDir, { recursive: true });

      const extension = path.extname(fileName);
      const baseName = path.basename(fileName, extension);
      const safeBaseName = sanitizeFileName(baseName);
      const finalFileName = `${Date.now()}-${randomUUID()}-${safeBaseName}${extension}`;
      const finalPath = path.join(uploadsDir, finalFileName);

      const finalWriter = createWriteStream(finalPath);
      let totalSize = 0;

      for (const chunkFile of chunkFiles) {
        const chunkFilePath = path.join(tempDir, chunkFile);
        const chunkStat = await stat(chunkFilePath);
        totalSize += chunkStat.size;

        if (totalSize > MAX_FILE_SIZE) {
          finalWriter.destroy();
          // Clean up
          await unlink(finalPath).catch(() => {});
          for (const f of chunkFiles) {
            await unlink(path.join(tempDir, f)).catch(() => {});
          }
          await unlink(tempDir).catch(() => {});
          const limitMb = (MAX_FILE_SIZE / (1024 * 1024)).toFixed(0);
          return NextResponse.json(
            { error: `Arquivo excede o limite de ${limitMb}MB.` },
            { status: 413 },
          );
        }

        await new Promise<void>((resolve, reject) => {
          const readStream = createReadStream(chunkFilePath);
          readStream.pipe(finalWriter, { end: false });
          readStream.on("end", resolve);
          readStream.on("error", reject);
        });
      }

      finalWriter.end();
      await new Promise<void>((resolve, reject) => {
        finalWriter.on("finish", resolve);
        finalWriter.on("error", reject);
      });

      // Clean up temp chunks
      for (const chunkFile of chunkFiles) {
        await unlink(path.join(tempDir, chunkFile)).catch(() => {});
      }
      // Try to remove the temp dir (ignore errors if not empty)
      await import("node:fs/promises").then((fs) => fs.rmdir(tempDir).catch(() => {}));

      if (totalSize === 0) {
        await unlink(finalPath).catch(() => {});
        return NextResponse.json({ error: "Arquivo vazio." }, { status: 400 });
      }

      return NextResponse.json({
        name: fileName,
        size: totalSize,
        url: `/uploads/${subDir}/${finalFileName}`,
      });
    }

    // --- Single-file upload (backward compat) ---
    const rawFileName = request.headers.get("x-filename") || "arquivo";
    const fileName = decodeURIComponent(rawFileName);
    const uploadsDir = path.join(process.cwd(), "public", "uploads", subDir);
    await mkdir(uploadsDir, { recursive: true });

    const extension = path.extname(fileName);
    const baseName = path.basename(fileName, extension);
    const safeBaseName = sanitizeFileName(baseName);
    const finalFileName = `${Date.now()}-${randomUUID()}-${safeBaseName}${extension}`;
    const finalPath = path.join(uploadsDir, finalFileName);

    const body = request.body;
    if (!body) {
      return NextResponse.json({ error: "Corpo da requisição vazio." }, { status: 400 });
    }

    let totalSize = 0;
    const writer = createWriteStream(finalPath);
    const reader = body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalSize += value.byteLength;
        if (totalSize > MAX_FILE_SIZE) {
          writer.destroy();
          await unlink(finalPath).catch(() => {});
          const limitMb = (MAX_FILE_SIZE / (1024 * 1024)).toFixed(0);
          return NextResponse.json(
            { error: `Arquivo excede o limite de ${limitMb}MB.` },
            { status: 413 },
          );
        }

        const ok = writer.write(Buffer.from(value));
        if (!ok) {
          await new Promise<void>((resolve) => writer.once("drain", resolve));
        }
      }
    } finally {
      writer.end();
    }

    await new Promise<void>((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    if (totalSize === 0) {
      await unlink(finalPath).catch(() => {});
      return NextResponse.json({ error: "Arquivo vazio." }, { status: 400 });
    }

    return NextResponse.json({
      name: fileName,
      size: totalSize,
      url: `/uploads/${subDir}/${finalFileName}`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha no upload." },
      { status: 500 },
    );
  }
}
