/**
 * Mistral-Agent-Client für den Recipe-Recorder.
 *
 * Wir nutzen Function-Calling mit einem einzigen Tool `next_action`, sodass das LLM
 * deterministisch eine Aktion zurueckgibt. Der DOM-Tree wird als JSON im user-Message
 * mitgeschickt. Passwoerter werden niemals serialisiert.
 */

import { Mistral } from "@mistralai/mistralai";
import { readCredentialSecret } from "@/lib/secrets/credential-store";

export type AgentActionType = "click" | "fill" | "press" | "wait" | "done" | "needs_vision";

export type AgentAction =
  | { type: "click"; elementId: string }
  | { type: "fill"; elementId: string; value: string }
  | { type: "press"; key: string }
  | { type: "wait"; timeoutMs?: number }
  | { type: "done"; reason: string }
  | { type: "needs_vision"; reason: string };

export type AgentDecision = {
  reasoning: string;
  action: AgentAction;
};

export type AgentMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AgentCallResult = {
  decision: AgentDecision | null;
  rawReply: string;
  usage: { inputTokens: number; outputTokens: number };
  modelUsed: string;
};

const PRIMARY_MODEL = "mistral-medium-latest";
const FALLBACK_MODEL = "mistral-large-latest";

const nextActionTool = {
  type: "function" as const,
  function: {
    name: "next_action",
    description:
      "Decide the next browser action toward the goal. Always return reasoning AND one action.",
    parameters: {
      type: "object",
      properties: {
        reasoning: {
          type: "string",
          description: "Brief reasoning why this action moves toward the goal.",
        },
        action: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["click", "fill", "press", "wait", "done", "needs_vision"],
              description: "The action type.",
            },
            element_id: {
              type: "string",
              description:
                "Element ID from the accessibility tree (e.g. 'el-12'). Required for click and fill.",
            },
            value: {
              type: "string",
              description:
                "For 'fill': either 'credential.username', 'credential.password', 'totp', or a literal text value.",
            },
            key: {
              type: "string",
              description: "For 'press': key name (e.g. 'Enter', 'Tab', 'Escape').",
            },
            timeout_ms: {
              type: "integer",
              description: "For 'wait': how long to wait in milliseconds.",
            },
            reason: {
              type: "string",
              description:
                "For 'done' or 'needs_vision': why the agent stopped or needs vision fallback.",
            },
          },
          required: ["type"],
        },
      },
      required: ["reasoning", "action"],
    },
  },
};

export async function callAgent(input: {
  messages: AgentMessage[];
  treeJson: string;
  goal: string;
  escalate?: boolean;
}): Promise<AgentCallResult> {
  const apiKey = await readCredentialSecret({ scope: "mistral" });
  if (!apiKey) {
    throw new Error("MISTRAL_API_KEY ist nicht konfiguriert.");
  }
  const client = new Mistral({ apiKey, timeoutMs: 30_000 });
  const model = input.escalate ? FALLBACK_MODEL : PRIMARY_MODEL;

  const messages = [
    {
      role: "system" as const,
      content: [
        "You are an autonomous browser agent that helps automate invoice collection from vendor portals.",
        `Goal: ${input.goal}`,
        "You will see the accessibility tree of the current page as JSON. Each element has an id (e.g. 'el-12').",
        "Respond ONLY by calling the 'next_action' function. Choose ONE action per turn.",
        "Available actions:",
        " - click: click an element by id",
        " - fill: fill a form field. For credentials, set value to 'credential.username', 'credential.password', or 'totp' — never expose real credentials.",
        " - press: press a keyboard key (Enter, Tab, etc.)",
        " - wait: wait for network/render to settle",
        " - done: stop the loop (you reached the goal or determined it's impossible)",
        " - needs_vision: request a visual fallback when DOM is ambiguous",
        "Prefer 'done' once you see an invoice list or after downloading.",
      ].join("\n"),
    },
    ...input.messages.map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user" as const,
      content: `Current accessibility tree:\n${input.treeJson}`,
    },
  ];

  const response = await client.chat.complete({
    model,
    temperature: 0,
    maxTokens: 512,
    tools: [nextActionTool],
    toolChoice: "any",
    messages,
  });

  const choice = response.choices?.[0];
  const toolCalls = choice?.message?.toolCalls ?? [];
  const rawReply = typeof choice?.message?.content === "string" ? choice.message.content : "";

  const usage = {
    inputTokens: response.usage?.promptTokens ?? 0,
    outputTokens: response.usage?.completionTokens ?? 0,
  };

  if (toolCalls.length === 0) {
    return { decision: null, rawReply, usage, modelUsed: model };
  }
  const args = toolCalls[0]?.function?.arguments;
  const parsed = typeof args === "string" ? safeJsonParse(args) : args;
  const decision = normalizeDecision(parsed);
  return { decision, rawReply, usage, modelUsed: model };
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeDecision(raw: unknown): AgentDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning : "";
  const actionRaw = obj.action as Record<string, unknown> | undefined;
  if (!actionRaw || typeof actionRaw !== "object") return null;
  const type = String(actionRaw.type || "");
  switch (type) {
    case "click":
      if (typeof actionRaw.element_id !== "string") return null;
      return { reasoning, action: { type: "click", elementId: actionRaw.element_id } };
    case "fill":
      if (typeof actionRaw.element_id !== "string" || typeof actionRaw.value !== "string")
        return null;
      return {
        reasoning,
        action: { type: "fill", elementId: actionRaw.element_id, value: actionRaw.value },
      };
    case "press":
      if (typeof actionRaw.key !== "string") return null;
      return { reasoning, action: { type: "press", key: actionRaw.key } };
    case "wait":
      return {
        reasoning,
        action: {
          type: "wait",
          timeoutMs: typeof actionRaw.timeout_ms === "number" ? actionRaw.timeout_ms : undefined,
        },
      };
    case "done":
      return {
        reasoning,
        action: {
          type: "done",
          reason: typeof actionRaw.reason === "string" ? actionRaw.reason : "",
        },
      };
    case "needs_vision":
      return {
        reasoning,
        action: {
          type: "needs_vision",
          reason: typeof actionRaw.reason === "string" ? actionRaw.reason : "",
        },
      };
    default:
      return null;
  }
}

// Mistral-Tokenpreise (Cent pro 1 Mio Token, Stand 2026)
const PRICE_PER_M_TOKENS_CENT: Record<string, { input: number; output: number }> = {
  "mistral-medium-latest": { input: 40, output: 200 },
  "mistral-large-latest": { input: 200, output: 600 },
};

export function calculateCostCents(
  usage: { inputTokens: number; outputTokens: number },
  model: string,
): number {
  const price = PRICE_PER_M_TOKENS_CENT[model] ?? PRICE_PER_M_TOKENS_CENT[PRIMARY_MODEL];
  const inputCents = (usage.inputTokens / 1_000_000) * price.input;
  const outputCents = (usage.outputTokens / 1_000_000) * price.output;
  return Math.round(inputCents + outputCents);
}
