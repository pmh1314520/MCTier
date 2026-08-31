export interface LobbySessionTicket {
  readonly generation: number;
  readonly signal: AbortSignal;
}

class LobbySessionCoordinator {
  private generation = 0;
  private controller: AbortController | null = null;

  begin(): LobbySessionTicket {
    this.controller?.abort('superseded-lobby-session');
    this.controller = new AbortController();
    this.generation += 1;
    return { generation: this.generation, signal: this.controller.signal };
  }

  current(): LobbySessionTicket | null {
    if (!this.controller || this.controller.signal.aborted) return null;
    return { generation: this.generation, signal: this.controller.signal };
  }

  isCurrent(ticket: LobbySessionTicket): boolean {
    return (
      !ticket.signal.aborted &&
      this.controller?.signal === ticket.signal &&
      this.generation === ticket.generation
    );
  }

  assertCurrent(ticket: LobbySessionTicket): void {
    if (!this.isCurrent(ticket)) throw new DOMException('大厅会话已被新的操作取代', 'AbortError');
  }

  cancel(ticket?: LobbySessionTicket): void {
    if (ticket && !this.isCurrent(ticket)) return;
    this.controller?.abort('lobby-session-cancelled');
    this.controller = null;
    this.generation += 1;
  }
}

export const lobbySessionCoordinator = new LobbySessionCoordinator();
