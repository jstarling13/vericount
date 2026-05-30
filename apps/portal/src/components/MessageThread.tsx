"use client";

import { useState, useRef, useEffect } from "react";
import { formatDate } from "@/lib/utils";

interface Message {
  id: string;
  sender: "CLIENT" | "BOOKKEEPER";
  content: string;
  createdAt: string;
}

export function MessageThread({
  clientId,
  messages: initialMessages,
}: {
  clientId: string;
  messages: Message[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, content: text.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setSendError(body.error ?? "Failed to send message. Please try again.");
        return;
      }
      const { message } = await res.json() as { message: Message };
      setMessages((prev) => [...prev, message]);
      setText("");
    } catch {
      setSendError("Network error — please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 flex flex-col" style={{ height: "calc(100vh - 180px)" }}>
      {/* Message list */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-8">
            No messages yet. Send a message to your bookkeeper below.
          </p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.sender === "CLIENT" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-sm rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.sender === "CLIENT"
                  ? "bg-[#0f4c81] text-white rounded-br-none"
                  : "bg-gray-100 text-gray-900 rounded-bl-none"
              }`}
            >
              <p>{msg.content}</p>
              <p
                className={`text-xs mt-1.5 ${
                  msg.sender === "CLIENT" ? "text-blue-200" : "text-gray-400"
                }`}
              >
                {formatDate(msg.createdAt)}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-100 p-4 flex flex-col gap-2">
        {sendError && (
          <p className="text-xs text-red-600 font-medium px-1">{sendError}</p>
        )}
        <div className="flex gap-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Message your bookkeeper…"
          rows={2}
          className="flex-1 resize-none border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0f4c81]/30 focus:border-[#0f4c81]"
        />
        <button
          onClick={send}
          disabled={!text.trim() || sending}
          className="bg-[#0f4c81] text-white px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-[#0d3f6e] transition-colors self-end"
        >
          Send
        </button>
        </div>
      </div>
    </div>
  );
}
