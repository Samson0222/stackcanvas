import { randomUUID } from "node:crypto";
import { schemaTask, metadata } from "@trigger.dev/sdk";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import { put } from "@vercel/blob";
import { z } from "zod";
import { chatMessageSchema } from "@/types/tasks";
import prisma from "@/lib/prisma";

const canvasNodeSchema = z
  .object({
    id: z.string(),
    type: z.string().optional(),
    position: z.object({ x: z.number(), y: z.number() }).optional(),
    data: z
      .object({
        label: z.string().optional(),
        color: z.string().optional(),
        shape: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const canvasEdgeSchema = z
  .object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    type: z.string().optional(),
    data: z
      .object({
        label: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const generateSpecPayloadSchema = z.object({
  projectId: z.string(),
  roomId: z.string(),
  chatHistory: z.array(chatMessageSchema).default([]),
  nodes: z.array(canvasNodeSchema).default([]),
  edges: z.array(canvasEdgeSchema).default([]),
});

export type GenerateSpecPayload = z.input<typeof generateSpecPayloadSchema>;

export const generateSpecTask = schemaTask({
  id: "generate-spec",
  schema: generateSpecPayloadSchema,
  maxDuration: 300,
  run: async (payload) => {
    const { projectId, nodes, edges, chatHistory } = payload;

    metadata.set("status", "analyzing");

    const nodesSummary = nodes
      .map((n) => `- ${n.id}: ${n.data?.label ?? "(unlabeled)"}${n.data?.shape ? ` [${n.data.shape}]` : ""}`)
      .join("\n");

    const edgesSummary = edges
      .map((e) => `- ${e.source} -> ${e.target}${e.data?.label ? ` (${e.data.label})` : ""}`)
      .join("\n");

    const chatSummary = chatHistory
      .map((m) => `${m.sender} (${m.role}): ${m.content}`)
      .join("\n");

    try {
      metadata.set("status", "generating");

      const google = createGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_AI_API_KEY ?? "",
      });

      const { text } = await generateText({
        model: google("gemini-3.5-flash"),
        system: `You are a senior software architect writing a technical specification in Markdown for a system design canvas.
                Use the provided canvas graph (nodes and edges) and conversation history as context. 
                Produce a clear, well-organised Markdown document with sections such as Overview, Components, Data Flow, and Key Considerations. 
                Reference node labels directly. Do not invent components that aren't present in the canvas unless clearly implied by the conversation. 
                Output plain Markdown only, no surrounding commentary.`,
        prompt: `## Canvas Nodes
            ${nodesSummary || "(no nodes)"}

            ## Canvas Edges
            ${edgesSummary || "(no edges)"}

            ## Conversation History
            ${chatSummary || "(no conversation)"}

            Generate the technical specification now.`,
      });

      metadata.set("status", "persisting");

      const specId = randomUUID();
      const blob = await put(`specs/${projectId}/${specId}.md`, text, {
        access: "private",
        contentType: "text/markdown",
        allowOverwrite: true,
      });
      await prisma.projectSpec.create({
        data: { id: specId, projectId, filePath: blob.url },
      });

      metadata.set("status", "completed");

      return { spec: text, specId };
    } catch (err) {
      metadata.set("status", "failed");
      throw err;
    }
  },
});
