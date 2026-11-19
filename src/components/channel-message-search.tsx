"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/types";

type Filters = { search: string; author: string; kind: string };

const resultFiles = (message: ChatMessage) => {
  const files = (message.attachments ?? []).map(({ id, name, url }) => ({ id, name, url }));
  for (const line of message.content.split("\n")) {
    const match = line.match(/^\[file\]\|(.+)\|\d+\|(\/uploads\/channels\/\S+)$/);
    if (match && !files.some((file) => file.url === match[2])) {
      files.push({ id: match[2], name: match[1], url: match[2] });
    }
  }
  return files;
};

export function ChannelMessageSearch({ serverId, channelId, members, onSelectMessage }: {
  serverId: string;
  channelId: string;
  members: { userId: string; userName: string }[];
  onSelectMessage: (message: ChatMessage) => Promise<void>;
}) {
  const [filters, setFilters] = useState<Filters>({ search: "", author: "", kind: "all" });
  const [submitted, setSubmitted] = useState<Filters | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [authorLabel, setAuthorLabel] = useState<string | null>(null);
  const [jumpingId, setJumpingId] = useState<string | null>(null);
  const memberQuery = authorLabel ? "" : filters.author.trim().toLowerCase();
  const matchingMembers = members.filter((member) =>
    member.userName.toLowerCase().includes(memberQuery) || member.userId.toLowerCase().includes(memberQuery),
  );

  const openMessage = async (message: ChatMessage) => {
    if (jumpingId) return;
    setJumpingId(message.id);
    try { await onSelectMessage(message); }
    finally { setJumpingId(null); }
  };

  useEffect(() => () => pending.current?.abort(), []);

  const search = async (nextFilters: Filters, older = false) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError("");
    if (!older) {
      setMessages([]);
      setHasMore(false);
      setSubmitted(nextFilters);
    }
    const params = new URLSearchParams({ ...nextFilters, limit: "30" });
    const last = older ? messages[messages.length - 1] : null;
    if (last) {
      params.set("beforeCreatedAt", last.createdAt);
      params.set("beforeId", last.id);
    }
    try {
      const response = await fetch(`/api/servers/${serverId}/channels/${channelId}/messages?${params}`, {
        signal: controller.signal, cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Falha ao pesquisar mensagens.");
      if (controller.signal.aborted) return;
      const page = (payload.messages as ChatMessage[]).slice().reverse();
      setMessages((current) => older ? [...current, ...page] : page);
      setHasMore(payload.hasMore);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Falha de conexão.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void search(filters);
  };

  return (
    <section aria-label="Pesquisa no histórico do canal" className="shrink-0 border-b border-[var(--tk-line)] bg-[var(--tk-bg-panel)] p-3">
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <input aria-label="Texto da mensagem" placeholder="Pesquisar no histórico deste canal" maxLength={200}
          value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })}
          className="min-w-40 flex-1 rounded bg-[var(--tk-bg-deep)] p-2 text-sm text-white" />
        <div className="relative" onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setShowMembers(false);
        }}>
          <input aria-label="Autor" role="combobox" aria-expanded={showMembers} aria-controls="channel-search-members"
            autoComplete="off" placeholder="Nome ou ID do usuário" maxLength={100}
            value={authorLabel ?? filters.author} onFocus={() => setShowMembers(true)}
            onKeyDown={(event) => { if (event.key === "Escape") setShowMembers(false); }}
            onChange={(event) => { setAuthorLabel(null); setFilters({ ...filters, author: event.target.value }); setShowMembers(true); }}
            className="rounded bg-[var(--tk-bg-deep)] p-2 text-sm text-white" />
          {showMembers && <div id="channel-search-members" role="listbox" aria-label="Membros do servidor"
            className="absolute top-full left-0 z-40 mt-1 max-h-64 w-72 overflow-y-auto rounded border border-white/10 bg-[var(--tk-bg-deep)] p-1 shadow-xl">
            <button type="button" role="option" aria-selected={!filters.author}
              onClick={() => { setFilters({ ...filters, author: "" }); setAuthorLabel(null); setShowMembers(false); }}
              className="w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-[var(--tk-accent)]">Todos os usuários</button>
            {matchingMembers.map((member) => <button key={member.userId} type="button" role="option"
              aria-selected={filters.author === member.userId}
              onClick={() => { setFilters({ ...filters, author: member.userId }); setAuthorLabel(member.userName); setShowMembers(false); }}
              className="block w-full rounded px-2 py-2 text-left text-sm text-white hover:bg-[var(--tk-accent)]">
              <span className="block truncate">{member.userName}</span><span className="text-xs text-zinc-400">{member.userId}</span>
            </button>)}
            {matchingMembers.length === 0 && <p className="p-2 text-xs text-zinc-400">Nenhum membro encontrado.</p>}
          </div>}
        </div>
        <select aria-label="Tipo de conteúdo" value={filters.kind}
          onChange={(event) => setFilters({ ...filters, kind: event.target.value })}
          className="rounded bg-[var(--tk-bg-deep)] p-2 text-sm text-white">
          <option value="all">Todos os conteúdos</option>
          <option value="media">Mídia</option>
          <option value="links">Links</option>
          <option value="files">Arquivos</option>
        </select>
        <button disabled={loading} className="rounded bg-[var(--tk-accent)] px-4 py-2 text-sm text-white disabled:opacity-50">Buscar</button>
      </form>
      <div aria-live="polite" className="max-h-[40vh] overflow-y-auto">
        {error && <p className="py-2 text-sm text-red-300">{error}</p>}
        {loading && <p className="py-2 text-sm text-zinc-400">Pesquisando...</p>}
        {submitted && !loading && !error && messages.length === 0 && <p className="py-2 text-sm text-zinc-400">Nenhuma mensagem encontrada.</p>}
        {messages.map((message) => (
          <article key={message.id} role="button" tabIndex={0} aria-label={`Ir para mensagem de ${message.userName}`}
            aria-busy={jumpingId === message.id} onClick={() => void openMessage(message)}
            onKeyDown={(event) => {
              if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault(); void openMessage(message);
              }
            }} className="cursor-pointer rounded border-t border-white/10 px-2 py-3 text-sm hover:bg-white/5 focus-visible:outline focus-visible:outline-indigo-400">
            <p className="text-zinc-400"><strong className="text-white">{message.userName}</strong> · {new Date(message.createdAt).toLocaleString("pt-BR")}</p>
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-zinc-200">{message.content.split("\n").filter((line) => !/^\[file\]\|/.test(line)).join("\n")}</p>
            {resultFiles(message).map((attachment) => (
              <button key={attachment.id} type="button" onClick={(event) => { event.stopPropagation(); void openMessage(message); }}
                className="mr-3 text-left text-blue-300 underline" title="Ir para esta mensagem no histórico">{attachment.name}</button>
            ))}
            <p className="mt-1 text-xs text-zinc-400">{jumpingId === message.id ? "Carregando mensagem..." : "Ir para mensagem no histórico"}</p>
          </article>
        ))}
        {hasMore && submitted && <button disabled={loading} onClick={() => void search(submitted, true)}
          className="rounded bg-[var(--tk-bg-elev)] px-3 py-2 text-sm text-white disabled:opacity-50">Mais resultados</button>}
      </div>
    </section>
  );
}
