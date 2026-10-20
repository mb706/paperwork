// The world gate's two conditions (10 §9.4): world sounds play only while the game runs and the map view is
// closed. The pause comes from the shell and the map view with every camera update, so the gate keeps both
// and opens only when neither holds; one could not otherwise reopen what the other closed (codex C7-r1
// finding 10).
export class WorldGate {
  private paused = false;
  private mapView = false;
  private openNow = true;

  get open(): boolean {
    return this.openNow;
  }

  /** Records a condition; returns the gate's new state when it changed, else null. */
  set(change: { paused?: boolean; mapView?: boolean }): boolean | null {
    if (change.paused !== undefined) this.paused = change.paused;
    if (change.mapView !== undefined) this.mapView = change.mapView;
    const open = !this.paused && !this.mapView;
    if (open === this.openNow) return null;
    this.openNow = open;
    return open;
  }
}
