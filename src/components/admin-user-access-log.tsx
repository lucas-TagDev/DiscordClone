"use client";

import { useEffect, useState } from "react";

type AccessLog = { id: string; event: string; ip: string | null; createdAt: string };

export function AdminUserAccessLog({ userId, name, onClose }: { userId: string; name: string; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/access-logs?page=${page}`, {
          cache: "no-store", signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Falha ao carregar acessos.");
        if (!controller.signal.aborted) { setLogs(payload.logs); setPages(payload.pages); }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Falha de conexão.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    return () => controller.abort();
  }, [page, userId]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="access-log-title" className="w-full max-w-2xl rounded-lg bg-gray-800 p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 id="access-log-title" className="text-xl font-bold">Acessos de {name}</h2>
        <button autoFocus type="button" onClick={onClose} className="rounded bg-gray-700 px-3 py-2">Fechar</button>
      </div>
      <div aria-live="polite" className="max-h-[60vh] overflow-auto">
        {loading ? <p>Carregando...</p> : error ? <p className="text-red-300">{error}</p> : logs.length === 0 ?
          <p className="text-gray-400">Nenhum acesso registrado. Os registros começam após esta atualização.</p> :
          <table className="w-full text-left text-sm">
            <thead><tr><th className="p-2">Data e hora</th><th className="p-2">Evento</th><th className="p-2">IP</th></tr></thead>
            <tbody>{logs.map((log) => <tr key={log.id} className="border-t border-gray-700">
              <td className="p-2">{new Date(log.createdAt).toLocaleString("pt-BR")}</td>
              <td className="p-2">{log.event === "register" ? "Cadastro" : "Login"}</td>
              <td className="p-2 font-mono">{log.ip ?? "Não informado pelo servidor"}</td>
            </tr>)}</tbody>
          </table>}
      </div>
      <div className="mt-4 flex items-center justify-between">
        <button disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded bg-gray-700 px-3 py-2 disabled:opacity-40">Anterior</button>
        <span>Página {page} de {pages}</span>
        <button disabled={loading || page >= pages} onClick={() => setPage((value) => value + 1)} className="rounded bg-gray-700 px-3 py-2 disabled:opacity-40">Próxima</button>
      </div>
    </section>
  </div>;
}
