// @ts-nocheck
import { toolWireSchema } from "../utils/schema.js";
import { getDialectDefinition } from "./factory.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const promptTemplate = readFileSync(join(import.meta.dirname ?? __dirname, "prompt-template.md"), "utf-8");
import type { Dialect, InbandTool } from "./types.js";

const TOOLS_TOKEN = "{{TOOLS}}";
const DIALECT_PROMPT_TOKEN = "{{DIALECT}}";

export function renderToolCatalog(tools: readonly InbandTool[]): string {
	return tools
		.map(tool =>
			JSON.stringify({
				type: "function",
				function: {
					name: tool.name,
					description: tool.description ?? "",
					parameters: toolWireSchema(tool),
				},
			}),
		)
		.join("\n");
}

export function renderInbandToolPrompt(tools: readonly InbandTool[], dialect: Dialect): string {
	const prompt = getDialectDefinition(dialect).prompt.trim();
	return promptTemplate
		.replace(TOOLS_TOKEN, () => renderToolCatalog(tools))
		.replace(DIALECT_PROMPT_TOKEN, () => prompt);
}
