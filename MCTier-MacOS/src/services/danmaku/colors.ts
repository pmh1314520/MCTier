/** Same vivid random palette for live messages and each pass of the settings preview. */
export function randomDanmakuColor(): string {
  return `hsl(${Math.floor(Math.random() * 360)}, 85%, 62%)`;
}
