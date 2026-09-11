const registeredSockets = new WeakSet<WebSocket>();

export function markSignalingSocketRegistered(socket: WebSocket): void {
  registeredSockets.add(socket);
}

export function invalidateSignalingSocket(socket: WebSocket | null): void {
  if (socket) registeredSockets.delete(socket);
}

export function isSignalingSocketRegistered(socket: WebSocket | null): socket is WebSocket {
  return socket !== null && socket.readyState === WebSocket.OPEN && registeredSockets.has(socket);
}
