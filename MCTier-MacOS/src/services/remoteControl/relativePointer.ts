import type { RemoteInputEvent } from './RemoteControlService';

/** Game input must never reposition the remote cursor, including clicks. */
export class RelativePointer {
  private x = 0;
  private y = 0;
  private buttons = new Set<number>();

  constructor(private send: (event: RemoteInputEvent) => void) {}

  move(dx: number, dy: number) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.x += Math.max(-32767, Math.min(32767, dx));
    this.y += Math.max(-32767, Math.min(32767, dy));
    const x = Math.trunc(this.x), y = Math.trunc(this.y);
    this.x -= x;
    this.y -= y;
    if (x || y) this.send({ kind: 'relative-move', dx: x, dy: y });
  }

  button(button: number, down: boolean) {
    if (!Number.isInteger(button) || button < 0 || button > 2) return;
    if (down) this.buttons.add(button);
    else if (!this.buttons.delete(button)) return;
    this.send({ kind: 'relative-button', button, down });
  }

  release() {
    for (const button of this.buttons) this.send({ kind: 'relative-button', button, down: false });
    this.buttons.clear();
    this.x = this.y = 0;
  }
}
