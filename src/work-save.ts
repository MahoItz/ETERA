import type { Work } from "../lib/model";

export type WorkDraft = Omit<Work, "id" | "revision" | "updatedAt">;
export type WorkSaveRequest = {
  requestId: string;
  id: string | null;
  revision: number | null;
  input: WorkDraft;
};

export class WorkSaveError extends Error {
  readonly rolledBack: boolean;
  constructor(message: string, rolledBack: boolean) {
    super(message);
    this.rolledBack = rolledBack;
  }
}

// Keep the exact request until the server has answered conclusively. In
// particular, a lost response must not turn a create into another create.
export class WorkSaveSession {
  private pending: WorkSaveRequest | null = null;
  private id: string | null;
  private revision: number | null;
  private saving = false;
  private readonly send: (request: WorkSaveRequest) => Promise<Work>;

  constructor(
    send: (request: WorkSaveRequest) => Promise<Work>,
    work: Pick<Work, "id" | "revision"> | null,
  ) {
    this.send = send;
    this.id = work?.id ?? null;
    this.revision = work?.revision ?? null;
  }

  private async resolve(): Promise<Work> {
    try {
      const result = await this.send(this.pending!);
      this.id = result.id;
      this.revision = result.revision;
      this.pending = null;
      return result;
    } catch (error) {
      if (error instanceof WorkSaveError && error.rolledBack) this.pending = null;
      throw error;
    }
  }

  async save(input: WorkDraft): Promise<Work> {
    if (this.saving) throw new Error("Дождитесь завершения сохранения.");
    this.saving = true;
    try {
      const draft = structuredClone(input);
      if (this.pending) {
        const previous = this.pending.input;
        const result = await this.resolve();
        if (JSON.stringify(previous) === JSON.stringify(draft)) return result;
        // The user edited the form after a timeout. Resolve the old operation
        // first, then save the new fields against the acknowledged revision.
      }
      this.pending = {
        requestId: crypto.randomUUID(), id: this.id, revision: this.revision, input: draft,
      };
      return await this.resolve();
    } finally {
      this.saving = false;
    }
  }
}
