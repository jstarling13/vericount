"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  id: string;
  sender: "CLIENT" | "BOOKKEEPER";
  content: string;
  createdAt: string;
}

export function MessagePanel({
  clientId,
  messages: initialMessages,
}: {
  clientId: string;
  messages: Message[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Mark unread CLIENT messages as read on mount
  useEffect(() => {
    fetch(`/api/messages/${clientId}/read`, { method: "POST" }).catch(() => {});
  }, [clientId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/messages/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, content: text.trim() }),
      });
      if (!res.ok) throw new Error("Send failed");
      const { message } = await res.json();
      setMessages((prev) => [...prev, message]);
      setText("");
    } catch {
      setError("Failed to send. Try again.");
    } finally {
      setSending(false);
    }
  }

  function fmtTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Messages</h3>

      {/* Thread */}
      <div className="space-y-2 max-h-72 overflow-y-auto mb-3 pr-1">
        {messages.length === 0 ? (
          <p className="text-xs text-gray-400">No messages yet.</p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`text-xs px-3 py-2 rounded-lg ${
                m.sender === "CLIENT"
                  ? "bg-blue-50 text-blue-800"
                  : "bg-gray-100 text-gray-700"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2 mb-0.5">
                <span className="font-semibold">
                  {m.sender === "CLIENT" ? "Client" : "You"}
                </span>
                <span className="text-gray-400 text-[10px] shrink-0">
                  {fmtTime(m.createdAt)}
                </span>
              </div>
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Compose */}
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Reply to client…"
          className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#0f4c81]/30"
        />
        <button
          onClick={send}
          disabled={!text.trim() || sending}
          className="text-xs bg-[#0f4c81] text-white px-3 py-2 rounded-lg hover:bg-[#0d3f6e] transition-colors disabled:opacity-40"
        >
          {sending ? "…" : "Send"}
        </button>
      </div>
      {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}
    </div>
  );
}
