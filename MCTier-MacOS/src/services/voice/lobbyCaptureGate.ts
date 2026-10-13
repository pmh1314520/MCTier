/** A recording lease silences all current and newly attached lobby tracks. */
export class LobbyCaptureGate {
  private leases = new Set<symbol>();
  private tracks = new Map<MediaStreamTrack, () => boolean>();
  register(track: MediaStreamTrack, canTransmit: () => boolean) {
    this.tracks.set(track, canTransmit);
    track.addEventListener('ended', () => this.tracks.delete(track), { once: true });
    this.apply();
  }
  private apply() {
    for (const [track, canTransmit] of this.tracks) {
      if (track.readyState === 'ended') { this.tracks.delete(track); continue; }
      track.enabled = this.leases.size === 0 && canTransmit();
    }
  }
  suspend(): () => void {
    const lease = Symbol();
    this.leases.add(lease);
    this.apply();
    return () => { this.leases.delete(lease); this.apply(); };
  }
}
export const lobbyCaptureGate = new LobbyCaptureGate();
