"use client";

import { useRef, useCallback, useState, useEffect } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { BotMessageSquare, X, FileText, Download, Send, Loader2, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  useEventListener,
  useOthers,
  useUpdateMyPresence,
  useSelf,
  useFeedMessages,
  useCreateFeedMessage,
} from "@liveblocks/react";
import { useRealtimeRun } from "@trigger.dev/react-hooks";
import type { designAgentTask } from "@/trigger/design-agent";
import type { generateSpecTask } from "@/trigger/generate-spec";
import { aiStatusFeedPayloadSchema, chatMessageSchema, type ChatMessageData } from "@/types/tasks";
import { useProjectSpecs } from "@/hooks/use-project-specs";
import { downloadSpecFile, type ProjectSpecListItem } from "@/lib/specs";
import { SpecPreviewModal } from "./spec-preview-modal";

const AI_SENDER_NAME = "StackCanvas";

const STARTER_CHIPS = [
  "Design an e-commerce backend",
  "Create a chat app architecture",
  "Build a CI/CD pipeline",
] as const;

interface AISidebarProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
}

interface ActiveRun {
  runId: string;
  accessToken: string;
}

// Mounted only while a run is active so useRealtimeRun is called with real values.
function RunSubscriber({
  runId,
  accessToken,
  onMessage,
  onComplete,
}: {
  runId: string;
  accessToken: string;
  onMessage: (msg: string) => void;
  onComplete: () => void;
}) {
  const { run } = useRealtimeRun<typeof designAgentTask>(runId, { accessToken });

  useEffect(() => {
    if (!run) return;

    if (run.status === "COMPLETED") {
      const output = run.output;
      if (output) {
        onMessage(`Design complete — ${output.nodeCount} nodes and ${output.edgeCount} edges added.`);
      }
      onComplete();
    } else if (run.status === "FAILED" || run.status === "CRASHED") {
      onMessage("Design generation failed. Please try again.");
      onComplete();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status]);

  return null;
}

// Mounted only while a spec-generation run is active.
function SpecRunSubscriber({
  runId,
  accessToken,
  onComplete,
  onError,
}: {
  runId: string;
  accessToken: string;
  onComplete: (specId: string) => void;
  onError: (message: string) => void;
}) {
  const { run } = useRealtimeRun<typeof generateSpecTask>(runId, { accessToken });

  useEffect(() => {
    if (!run) return;

    if (run.status === "COMPLETED") {
      if (run.output) {
        onComplete(run.output.specId);
      } else {
        onError("Spec generation completed but returned no result.");
      }
    } else if (run.status === "FAILED" || run.status === "CRASHED") {
      onError("Spec generation failed. Please try again.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status]);

  return null;
}

// The "ai-chat" feed is created server-side in /api/liveblocks-auth before
// the client ever receives a token to connect with, so by the time this
// component's hooks run the feed is guaranteed to already exist — no
// client-side creation or gating needed here.
export function AISidebar({ isOpen, onClose, projectId }: AISidebarProps) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [isRoomAiActive, setIsRoomAiActive] = useState(false);
  const [feedMessage, setFeedMessage] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const feedClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Textarea expand state
  const [isArchitectExpanded, setIsArchitectExpanded] = useState(false);
  const [isChatExpanded, setIsChatExpanded] = useState(false);

  // Chat tab state
  const [chatInput, setChatInput] = useState("");
  const [chatSendError, setChatSendError] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null);

  const others = useOthers();
  const updateMyPresence = useUpdateMyPresence();
  const self = useSelf();

  // Specs tab state
  const { specs, isLoading: specsLoading, error: specsError, refetch: refetchSpecs } = useProjectSpecs(projectId);
  const [previewSpec, setPreviewSpec] = useState<ProjectSpecListItem | null>(null);
  const [isSpecPreviewOpen, setIsSpecPreviewOpen] = useState(false);
  const [isGeneratingSpec, setIsGeneratingSpec] = useState(false);
  const [specGenError, setSpecGenError] = useState<string | null>(null);
  const [activeSpecRun, setActiveSpecRun] = useState<ActiveRun | null>(null);

  const openSpecPreview = useCallback((spec: ProjectSpecListItem) => {
    setPreviewSpec(spec);
    setIsSpecPreviewOpen(true);
  }, []);

  // ai-chat Liveblocks feed — created server-side, see AISidebar comment above
  const createFeedMessage = useCreateFeedMessage();
  const { messages: feedMessages, isLoading: feedLoading, error: feedError } = useFeedMessages("ai-chat");

  const handleGenerateSpec = useCallback(async () => {
    if (isGeneratingSpec) return;
    setIsGeneratingSpec(true);
    setSpecGenError(null);

    try {
      const canvasRes = await fetch(`/api/projects/${projectId}/canvas`);
      const canvasData = canvasRes.ok
        ? ((await canvasRes.json()) as { canvas: { nodes?: unknown[]; edges?: unknown[] } | null })
        : { canvas: null };

      const chatHistory: ChatMessageData[] = (feedMessages ?? [])
        .map((msg) => chatMessageSchema.safeParse(msg.data))
        .filter((parsed) => parsed.success)
        .map((parsed) => parsed.data);

      const specRes = await fetch("/api/ai/spec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: projectId,
          chatHistory,
          nodes: canvasData.canvas?.nodes ?? [],
          edges: canvasData.canvas?.edges ?? [],
        }),
      });

      if (!specRes.ok) {
        const err = await specRes.json().catch(() => ({ error: "Request failed" }));
        setSpecGenError((err as { error?: string }).error ?? "Failed to start spec generation.");
        setIsGeneratingSpec(false);
        return;
      }

      const { runId } = (await specRes.json()) as { runId: string };

      const tokenRes = await fetch("/api/ai/spec/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });

      if (!tokenRes.ok) {
        setSpecGenError("Could not subscribe to spec generation status.");
        setIsGeneratingSpec(false);
        return;
      }

      const { token } = (await tokenRes.json()) as { token: string };
      setActiveSpecRun({ runId, accessToken: token });
    } catch {
      setSpecGenError("Failed to start spec generation. Please try again.");
      setIsGeneratingSpec(false);
    }
  }, [isGeneratingSpec, projectId, feedMessages]);

  const handleSpecRunComplete = useCallback(
    (specId: string) => {
      setActiveSpecRun(null);
      setIsGeneratingSpec(false);
      refetchSpecs().then(() => {
        openSpecPreview({
          id: specId,
          createdAt: new Date().toISOString(),
          filename: `spec-${specId}.md`,
        });
      });
    },
    [refetchSpecs, openSpecPreview]
  );

  const handleSpecRunError = useCallback((message: string) => {
    setActiveSpecRun(null);
    setIsGeneratingSpec(false);
    setSpecGenError(message);
  }, []);

  // Room-wide AI active: room events (from Trigger task) OR any participant's presence
  const anyThinking =
    isLoading ||
    isRoomAiActive ||
    others.some((o) => o.presence.thinking);

  // Subscribe to ai-status-feed via room events
  useEventListener(({ event }) => {
    if (event.type === "AI_THINKING_START") {
      setIsRoomAiActive(true);
      if (feedClearTimerRef.current) clearTimeout(feedClearTimerRef.current);
    } else if (event.type === "AI_THINKING_END") {
      setIsRoomAiActive(false);
      feedClearTimerRef.current = setTimeout(() => setFeedMessage(null), 3000);
    } else if (event.type === "AI_STATUS") {
      // Map AI_STATUS into the ai-status-feed schema (message → text)
      const parsed = aiStatusFeedPayloadSchema.safeParse({ text: event.message });
      if (parsed.success) setFeedMessage(parsed.data.text ?? null);
    } else if (event.type === "AI_FEED") {
      // Native ai-status-feed events (future use)
      const parsed = aiStatusFeedPayloadSchema.safeParse(event);
      if (parsed.success) setFeedMessage(parsed.data.text ?? null);
    }
  });

  useEffect(() => {
    return () => {
      if (feedClearTimerRef.current) clearTimeout(feedClearTimerRef.current);
    };
  }, []);

  // Scroll chat to bottom when new feed messages arrive
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [feedMessages]);

  const resetTextarea = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "72px";
    }
  }, []);

  // Scroll to bottom when the shared ai-chat feed updates
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [feedMessages]);

  const pushFeedMessage = useCallback(
    async (role: "user" | "assistant", content: string) => {
      try {
        await createFeedMessage("ai-chat", {
          sender: role === "assistant" ? AI_SENDER_NAME : self?.info?.name ?? "Anonymous",
          role,
          content,
          timestamp: Date.now(),
        });
      } catch (err) {
        // Best-effort — a failed feed push shouldn't block the design run itself.
        console.error("Failed to push ai-chat feed message", err);
      }
    },
    [createFeedMessage, self?.info?.name]
  );

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || anyThinking) return;

    setInput("");
    resetTextarea();
    setIsLoading(true);
    updateMyPresence({ thinking: true });
    await pushFeedMessage("user", text);

    try {
      const designRes = await fetch("/api/ai/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, roomId: projectId, projectId }),
      });

      if (!designRes.ok) {
        const err = await designRes.json().catch(() => ({ error: "Request failed" }));
        await pushFeedMessage("assistant", `Error: ${(err as { error?: string }).error ?? "Unknown error"}`);
        setIsLoading(false);
        updateMyPresence({ thinking: false });
        return;
      }

      const { runId } = (await designRes.json()) as { runId: string };

      const tokenRes = await fetch("/api/ai/design/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });

      if (!tokenRes.ok) {
        await pushFeedMessage("assistant", "Could not subscribe to run status. Check the canvas for updates.");
        setIsLoading(false);
        updateMyPresence({ thinking: false });
        return;
      }

      const { token } = (await tokenRes.json()) as { token: string };

      setActiveRun({ runId, accessToken: token });
    } catch {
      await pushFeedMessage("assistant", "Failed to start design generation. Please try again.");
      setIsLoading(false);
      updateMyPresence({ thinking: false });
    }
  }, [input, anyThinking, projectId, pushFeedMessage, resetTextarea, updateMyPresence]);

  const handleRunComplete = useCallback(() => {
    setActiveRun(null);
    setIsLoading(false);
    updateMyPresence({ thinking: false });
  }, [updateMyPresence]);

  const handleRunMessage = useCallback(
    (msg: string) => {
      void pushFeedMessage("assistant", msg);
    },
    [pushFeedMessage]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !isComposingRef.current) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleChip = useCallback(
    (chip: string) => {
      setInput(chip);
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
    []
  );

  const handleInputChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const handleChatInputChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setChatInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const handleChatSend = useCallback(async () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatSendError(null);
    try {
      await createFeedMessage("ai-chat", {
        sender: self?.info?.name ?? "Anonymous",
        role: "user",
        content: text,
        timestamp: Date.now(),
      });
      setChatInput("");
      if (chatTextareaRef.current) chatTextareaRef.current.style.height = "72px";
    } catch {
      setChatSendError("Failed to send. Try again.");
    }
  }, [chatInput, createFeedMessage, self?.info?.name]);

  return (
    <>
      {activeRun && (
        <RunSubscriber
          runId={activeRun.runId}
          accessToken={activeRun.accessToken}
          onMessage={handleRunMessage}
          onComplete={handleRunComplete}
        />
      )}

      {activeSpecRun && (
        <SpecRunSubscriber
          runId={activeSpecRun.runId}
          accessToken={activeSpecRun.accessToken}
          onComplete={handleSpecRunComplete}
          onError={handleSpecRunError}
        />
      )}

      <aside
        aria-hidden={!isOpen}
        inert={!isOpen || undefined}
        className={cn(
          "fixed right-0 top-12 bottom-0 z-40 flex w-80 flex-col",
          "border-l border-border-subtle bg-surface/95 shadow-2xl backdrop-blur-sm",
          "transition-transform duration-200",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex shrink-0 flex-col border-b border-border-subtle">
          <div className="flex items-start gap-3 px-4 py-3">
            <BotMessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-ai-text" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                <p className="text-sm font-semibold text-copy-primary">AI Workspace</p>
                {anyThinking && (
                  <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-success/40 bg-success/15 px-2.5 py-1 text-[10px] font-medium text-success">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                    Working…
                  </span>
                )}
              </div>
              <p className="text-xs text-copy-muted">Collaborate with StackCanvas</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-copy-muted hover:text-copy-primary"
              onClick={onClose}
              aria-label="Close AI sidebar"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="architect" className="flex min-h-0 flex-1 flex-col gap-0">
          <TabsList className="mx-4 mt-3 grid w-auto grid-cols-3">
            <TabsTrigger value="architect">Architect</TabsTrigger>
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="specs">Specs</TabsTrigger>
          </TabsList>

          {/* AI Architect Tab */}
          <TabsContent value="architect" className="min-h-0 flex flex-col">
            <ScrollArea className="flex-1" viewportRef={scrollRef}>
              {feedLoading ? (
                <div className="flex items-center justify-center gap-2 py-8">
                  <Loader2 className="h-4 w-4 animate-spin text-copy-muted" />
                  <span className="text-xs text-copy-muted">Loading conversation…</span>
                </div>
              ) : feedError ? (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <p className="text-xs text-copy-muted">Could not load chat. Reload and try again.</p>
                </div>
              ) : !feedMessages || feedMessages.length === 0 ? (
                <div className="flex flex-col items-center gap-4 px-4 py-8 text-center">
                  <BotMessageSquare className="h-8 w-8 text-ai-text/60" />
                  <div>
                    <p className="text-sm font-medium text-copy-primary">StackCanvas Architect</p>
                    <p className="mt-1 text-xs text-copy-muted">
                      Describe your system and I&apos;ll design the architecture on the canvas.
                    </p>
                  </div>
                  <div className="flex w-full flex-col gap-2">
                    {STARTER_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        onClick={() => handleChip(chip)}
                        disabled={anyThinking}
                        className="w-full rounded-full bg-subtle px-3 py-2 text-left text-xs text-ai-text transition-colors hover:bg-elevated disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 p-4">
                  {feedMessages.map((msg) => {
                    const parsed = chatMessageSchema.safeParse(msg.data);
                    if (!parsed.success) return null;
                    const { role, content } = parsed.data;
                    const isMe = role === "user" && parsed.data.sender === (self?.info?.name ?? "Anonymous");

                    if (role === "user") {
                      return (
                        <div key={msg.id} className={cn("flex", isMe ? "justify-end" : "justify-start")}>
                          <div className="max-w-[85%] rounded-2xl border-2 border-success/50 bg-success/15 px-3 py-2">
                            <p className="text-xs text-copy-primary">{content}</p>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={msg.id} className="flex justify-start">
                        <div className="max-w-[85%] rounded-2xl border border-border-subtle bg-elevated px-3 py-2">
                          <p className="text-xs text-ai-text">{content}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>

            <div className="shrink-0 border-t border-border-subtle p-3">
              {/* AI status feed — shown above the input, only while a run is active */}
              {anyThinking && feedMessage && (
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-border-subtle bg-elevated/60 px-3 py-1.5">
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-ai" />
                  <span className="truncate text-xs text-ai-text">{feedMessage}</span>
                </div>
              )}
              <div className="flex flex-col rounded-xl border border-border-subtle bg-elevated overflow-hidden">
                {/* Top row: expand/collapse toggle */}
                <div className="flex justify-end px-2 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      const next = !isArchitectExpanded;
                      setIsArchitectExpanded(next);
                      if (textareaRef.current) {
                        textareaRef.current.style.height = next ? "220px" : "72px";
                      }
                    }}
                    className="h-6 w-6 text-copy-faint hover:text-copy-muted"
                    aria-label={isArchitectExpanded ? "Collapse input" : "Expand input"}
                  >
                    {isArchitectExpanded ? (
                      <Minimize2 className="h-3.5 w-3.5" />
                    ) : (
                      <Maximize2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
                {/* Textarea */}
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onCompositionStart={() => { isComposingRef.current = true; }}
                  onCompositionEnd={() => { isComposingRef.current = false; }}
                  placeholder="Describe your architecture…"
                  aria-label="Message input"
                  className={cn(
                    "w-full resize-none overflow-y-auto border-0 bg-transparent px-3 text-xs text-copy-primary placeholder:text-copy-faint shadow-none",
                    "focus-visible:ring-0 focus-visible:border-0",
                    isArchitectExpanded ? "min-h-[220px] max-h-[320px]" : "min-h-[72px] max-h-[160px]"
                  )}
                  style={{ height: isArchitectExpanded ? "220px" : "72px" }}
                  disabled={anyThinking}
                />
                {/* Bottom row: send button */}
                <div className="flex justify-end px-2 pb-2">
                  <Button
                    size="icon"
                    disabled={!input.trim() || anyThinking}
                    onClick={handleSend}
                    className="h-8 w-8 rounded-full bg-ai text-white hover:bg-ai/90 disabled:opacity-40"
                    aria-label="Send message"
                  >
                    {anyThinking ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Chat Tab */}
          <TabsContent value="chat" className="min-h-0 flex flex-col">
            <ScrollArea className="flex-1" viewportRef={chatScrollRef}>
              {feedLoading ? (
                <div className="flex items-center justify-center gap-2 py-8">
                  <Loader2 className="h-4 w-4 animate-spin text-copy-muted" />
                  <span className="text-xs text-copy-muted">Loading chat…</span>
                </div>
              ) : feedError ? (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <p className="text-xs text-copy-muted">Could not load chat. Reload and try again.</p>
                </div>
              ) : !feedMessages || feedMessages.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
                  <p className="text-sm font-medium text-copy-primary">Room Chat</p>
                  <p className="text-xs text-copy-muted">
                    Send a message to collaborate with others in this room.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3 p-4">
                  {feedMessages.map((msg) => {
                    const parsed = chatMessageSchema.safeParse(msg.data);
                    if (!parsed.success) return null;
                    const { sender, content } = parsed.data;
                    const isMe = sender === (self?.info?.name ?? "Anonymous");
                    const time = new Date(msg.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    });
                    return (
                      <div key={msg.id} className={cn("flex flex-col gap-0.5", isMe ? "items-end" : "items-start")}>
                        <div className="flex items-center gap-1.5">
                          {!isMe && <span className="text-[10px] font-medium text-copy-secondary">{sender}</span>}
                          <span className="text-[10px] text-copy-faint">{time}</span>
                          {isMe && <span className="text-[10px] font-medium text-copy-secondary">You</span>}
                        </div>
                        <div
                          className={cn(
                            "max-w-[85%] rounded-2xl px-3 py-2",
                            isMe
                              ? "border-2 border-brand/50 bg-brand-dim"
                              : "border border-border-subtle bg-elevated"
                          )}
                        >
                          <p className="text-xs text-copy-primary">{content}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>

            <div className="shrink-0 border-t border-border-subtle p-3">
              {chatSendError && (
                <p className="mb-2 text-[10px] text-error">{chatSendError}</p>
              )}
              <div className="flex flex-col rounded-xl border border-border-subtle bg-elevated overflow-hidden">
                {/* Top row: expand/collapse toggle */}
                <div className="flex justify-end px-2 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      const next = !isChatExpanded;
                      setIsChatExpanded(next);
                      if (chatTextareaRef.current) {
                        chatTextareaRef.current.style.height = next ? "220px" : "72px";
                      }
                    }}
                    className="h-6 w-6 text-copy-faint hover:text-copy-muted"
                    aria-label={isChatExpanded ? "Collapse input" : "Expand input"}
                  >
                    {isChatExpanded ? (
                      <Minimize2 className="h-3.5 w-3.5" />
                    ) : (
                      <Maximize2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
                {/* Textarea */}
                <Textarea
                  ref={chatTextareaRef}
                  value={chatInput}
                  onChange={handleChatInputChange}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleChatSend();
                    }
                  }}
                  placeholder="Message the room…"
                  aria-label="Chat message input"
                  className={cn(
                    "w-full resize-none overflow-y-auto border-0 bg-transparent px-3 text-xs text-copy-primary placeholder:text-copy-faint shadow-none",
                    "focus-visible:ring-0 focus-visible:border-0",
                    isChatExpanded ? "min-h-[220px] max-h-[320px]" : "min-h-[72px] max-h-[160px]"
                  )}
                  style={{ height: isChatExpanded ? "220px" : "72px" }}
                />
                {/* Bottom row: send button */}
                <div className="flex justify-end px-2 pb-2">
                  <Button
                    size="icon"
                    disabled={!chatInput.trim()}
                    onClick={() => void handleChatSend()}
                    className="h-8 w-8 rounded-full bg-ai text-white hover:bg-ai/90 disabled:opacity-40"
                    aria-label="Send chat message"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Specs Tab */}
          <TabsContent value="specs" className="min-h-0 flex flex-col">
            <div className="shrink-0 px-4 pt-8 pb-2">
              <Button
                onClick={handleGenerateSpec}
                disabled={isGeneratingSpec}
                className="w-full gap-1.5 bg-ai text-white hover:bg-ai/90 focus-visible:border-copy-primary focus-visible:ring-copy-primary/50 disabled:opacity-60"
              >
                {isGeneratingSpec && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {isGeneratingSpec ? "Generating…" : "Generate Spec"}
              </Button>
              {specGenError && <p className="mt-2 text-xs text-error">{specGenError}</p>}
            </div>

            <ScrollArea className="flex-1">
              <div className="flex flex-col gap-2 p-4 pt-2">
                {specsLoading ? (
                  <div className="flex items-center justify-center gap-2 py-8">
                    <Loader2 className="h-4 w-4 animate-spin text-copy-muted" />
                    <span className="text-xs text-copy-muted">Loading specs…</span>
                  </div>
                ) : specsError ? (
                  <p className="py-8 text-center text-xs text-error">{specsError}</p>
                ) : specs.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
                    <FileText className="h-8 w-8 text-ai-text/60" />
                    <p className="text-sm font-medium text-copy-primary">No specs yet</p>
                    <p className="text-xs text-copy-muted">
                      Generate a spec from your canvas to see it listed here.
                    </p>
                  </div>
                ) : (
                  specs.map((spec) => (
                    <div
                      key={spec.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openSpecPreview(spec)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openSpecPreview(spec);
                        }
                      }}
                      className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border-subtle bg-elevated p-3 text-left transition-colors hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ai"
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ai-text" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-copy-primary">{spec.filename}</p>
                        <p className="mt-1 text-[10px] text-copy-muted">
                          {new Date(spec.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 self-start text-copy-muted hover:text-copy-primary"
                        aria-label={`Download ${spec.filename}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadSpecFile(projectId, spec.id, spec.filename);
                        }}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </aside>

      <SpecPreviewModal
        open={isSpecPreviewOpen}
        onOpenChange={setIsSpecPreviewOpen}
        projectId={projectId}
        specId={previewSpec?.id ?? null}
        filename={previewSpec?.filename ?? null}
      />
    </>
  );
}
