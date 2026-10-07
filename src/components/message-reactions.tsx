"use client";

import { useState } from "react";
import type { MessageReaction } from "@/lib/types";

type ReactionGroup = {
  emoji: string;
  count: number;
  userIds: string[];
  names: string[];
};

const groupReactions = (reactions: MessageReaction[]): ReactionGroup[] => {
  const byEmoji = new Map<string, ReactionGroup>();
  reactions.forEach((reaction) => {
    const existing = byEmoji.get(reaction.emoji);
    if (existing) {
      existing.count += 1;
      existing.userIds.push(reaction.userId);
      existing.names.push(reaction.userName);
    } else {
      byEmoji.set(reaction.emoji, {
        emoji: reaction.emoji,
        count: 1,
        userIds: [reaction.userId],
        names: [reaction.userName],
      });
    }
  });
  return Array.from(byEmoji.values()).sort((a, b) => b.count - a.count);
};

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "😄"];

export function MessageReactions({
  reactions = [],
  currentUserId,
  onToggle,
}: {
  reactions?: MessageReaction[];
  currentUserId: string;
  onToggle: (emoji: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const groups = groupReactions(reactions);
  const normalizedCurrentUserId = currentUserId.trim().toLowerCase();

  const toggleReaction = (emoji: string) => {
    setPickerOpen(false);
    onToggle(emoji);
  };

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {groups.map((group) => {
        const reacted = group.userIds.some((id) => id.trim().toLowerCase() === normalizedCurrentUserId);
        return (
          <button
            key={group.emoji}
            type="button"
            onClick={() => toggleReaction(group.emoji)}
            title={group.names.join(", ")}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
              reacted
                ? "border-indigo-500 bg-indigo-500/20 text-indigo-200"
                : "border-zinc-700 bg-zinc-800/70 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            <span>{group.emoji}</span>
            <span className="text-[11px]">{group.count}</span>
          </button>
        );
      })}

      {pickerOpen ? (
        <div className="flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 p-1">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => toggleReaction(emoji)}
              className="rounded-full px-1 text-base hover:bg-zinc-700 transition-colors"
              title={`Reagir com ${emoji}`}
            >
              {emoji}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPickerOpen(false)}
            className="ml-1 rounded-full px-1 text-xs text-zinc-400 hover:bg-zinc-700 transition-colors"
            title="Fechar"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800/70 px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
          title="Adicionar reação"
        >
          +
        </button>
      )}
    </div>
  );
}
