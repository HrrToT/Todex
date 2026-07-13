import type { LlmClient, LlmTurnContext } from "./llm.js";

export interface ScriptedMockLlmOptions {
  readonly onTurn?: (context: LlmTurnContext) => void;
}

export class ScriptedMockLlm implements LlmClient {
  private readonly script: readonly unknown[];
  private readonly onTurn?: (context: LlmTurnContext) => void;
  private index = 0;
  public readonly contexts: LlmTurnContext[] = [];

  constructor(script: readonly unknown[], options?: ScriptedMockLlmOptions) {
    this.script = script;
    this.onTurn = options?.onTurn;
  }

  async nextAction(context: LlmTurnContext): Promise<unknown> {
    this.contexts.push(context);
    this.onTurn?.(context);
    if (this.index >= this.script.length) {
      throw new Error("mock script exhausted");
    }
    const value = this.script[this.index];
    this.index += 1;
    return value;
  }
}
