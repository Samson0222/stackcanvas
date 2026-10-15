import { schemaTask } from "@trigger.dev/sdk";
import { generateObject } from "ai";
import { z } from "zod";
import { getLiveblocks } from "@/lib/liveblocks";
import { getQuotaRetryDelayMs, handleGeminiTaskError, withGeminiModel } from "@/lib/ai-model";
import { NODE_SHAPES, NODE_COLORS } from "@/types/canvas";
import type { CanvasNode, CanvasEdge, NodeShape } from "@/types/canvas";

const designAgentPayloadSchema = z.object({
  prompt: z.string().min(1),
  roomId: z.string().min(1),
});

const designSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string().describe("unique slug id, e.g. 'api-gateway'"),
      label: z.string().describe("display label shown on the node"),
      shape: z
        .enum(NODE_SHAPES)
        .describe(
          "node shape: rectangle=general, diamond=gateway/decision, circle=event/endpoint, pill=service/worker, cylinder=database/storage, hexagon=external/queue"
        ),
      colorIndex: z
        .number()
        .int()
        .min(0)
        .max(7)
        .describe(
          "color palette index 0-7: 0=neutral, 1=blue(API/client), 2=purple(AI/worker), 3=orange(queue), 4=red(auth/security), 5=pink(identity), 6=green(database), 7=teal(cache/CDN)"
        ),
      x: z.number().describe("canvas x position"),
      y: z.number().describe("canvas y position"),
      width: z.number().optional().describe("node width in pixels"),
      height: z.number().optional().describe("node height in pixels"),
    })
  ),
  edges: z.array(
    z.object({
      sourceId: z.string().describe("source node id"),
      targetId: z.string().describe("target node id"),
      label: z.string().optional().describe("optional edge label"),
    })
  ),
});

const DEFAULT_SIZES: Record<NodeShape, { width: number; height: number }> = {
  rectangle: { width: 160, height: 80 },
  diamond: { width: 140, height: 140 },
  circle: { width: 100, height: 100 },
  pill: { width: 160, height: 64 },
  cylinder: { width: 120, height: 120 },
  hexagon: { width: 140, height: 140 },
};

const MAX_ATTEMPTS = 3;

type LiveblocksInstance = ReturnType<typeof getLiveblocks>;

async function broadcast(
  lb: LiveblocksInstance,
  roomId: string,
  event: Liveblocks["RoomEvent"]
) {
  await lb.broadcastEvent(roomId, event);
}

export const designAgentTask = schemaTask({
  id: "design-agent",
  maxDuration: 300,
  schema: designAgentPayloadSchema,
  retry: { maxAttempts: MAX_ATTEMPTS, factor: 2, minTimeoutInMs: 1000, maxTimeoutInMs: 10000 },
  queue: { concurrencyLimit: 5 },
  catchError: handleGeminiTaskError,
  run: async (payload, { ctx }) => {
    const { prompt, roomId } = payload;
    const lb = getLiveblocks();

    await broadcast(lb, roomId, { type: "AI_THINKING_START" });
    await broadcast(lb, roomId, { type: "AI_STATUS", message: "StackCanvas is analyzing your request…" });

    try {
      await broadcast(lb, roomId, { type: "AI_STATUS", message: "StackCanvas is designing your architecture…" });

      const colorHints = NODE_COLORS.map(
        (c, i) => `${i}: fill ${c.fill} / text ${c.text}`
      ).join(", ");

      const { object: design } = await withGeminiModel((model) => generateObject({
        model,
        maxRetries: 0,
        system: `You are an expert system architect designing a real-time collaborative canvas layout.

Shapes: ${NODE_SHAPES.join(", ")}
  • rectangle  — general component, service
  • diamond    — gateway / load balancer / decision
  • circle     — event / endpoint / user
  • pill       — background service / worker / process
  • cylinder   — database / cache / storage
  • hexagon    — external system / queue / boundary

Color palette (colorIndex 0–7):
${colorHints}
Use colors that match component role (e.g. 6=green for databases, 7=teal for caches, 1=blue for APIs).

Layout rules:
  • Flow left→right or top→bottom
  • Space nodes 200–320 px apart
  • Use x: 80–1400, y: 60–800
  • Default sizes: rectangle 160×80, diamond 140×140, circle 100×100, pill 160×64, cylinder 120×120, hexagon 140×140
  • Create an accurate, clear, well-organised system design.`,
        prompt,
        schema: designSchema,
      }));

      await broadcast(lb, roomId, {
        type: "AI_STATUS",
        message: `Building ${design.nodes.length} nodes and ${design.edges.length} edges…`,
      });

      const canvasNodes: CanvasNode[] = design.nodes.map((n) => {
        const color = NODE_COLORS[n.colorIndex] ?? NODE_COLORS[0];
        const sizes = DEFAULT_SIZES[n.shape] ?? DEFAULT_SIZES.rectangle;
        return {
          id: n.id,
          type: "canvasNode" as const,
          position: { x: n.x, y: n.y },
          data: {
            label: n.label,
            color: color.fill,
            shape: n.shape,
          },
          width: n.width ?? sizes.width,
          height: n.height ?? sizes.height,
        };
      });

      const canvasEdges: CanvasEdge[] = design.edges.map((e, idx) => ({
        id: `ai-edge-${idx}-${Date.now()}`,
        type: "canvasEdge" as const,
        source: e.sourceId,
        target: e.targetId,
        data: { label: e.label },
        markerEnd: { type: "arrowclosed" as const, color: "#f8fafc" },
      }));

      // Broadcast canvas operations through the shared Liveblocks room so all
      // connected clients apply them via their existing collaborative flow hooks.
      // Canvas data is serialised as a JSON string to satisfy Liveblocks' Json
      // value constraint on RoomEvent.
      await broadcast(lb, roomId, {
        type: "AI_CANVAS_BATCH",
        data: JSON.stringify({ nodes: canvasNodes, edges: canvasEdges }),
        replace: false,
      });

      await broadcast(lb, roomId, {
        type: "AI_STATUS",
        message: `Done — ${canvasNodes.length} nodes and ${canvasEdges.length} edges added.`,
      });

      return { success: true, nodeCount: canvasNodes.length, edgeCount: canvasEdges.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const quotaDelayMs = getQuotaRetryDelayMs(err);
      const willRetry = quotaDelayMs != null && ctx.attempt.number < MAX_ATTEMPTS;
      await broadcast(lb, roomId, {
        type: "AI_STATUS",
        message:
          quotaDelayMs === undefined
            ? `Design failed: ${message}`
            : willRetry
              ? `AI rate limit reached — retrying in ${Math.ceil(quotaDelayMs / 1000)}s…`
              : "Design failed: AI usage limit reached. Try again later.",
      });
      throw err;
    } finally {
      await broadcast(lb, roomId, { type: "AI_THINKING_END" });
    }
  },
});
