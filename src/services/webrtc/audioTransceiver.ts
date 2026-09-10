export function sendingAudioTransceiver(pc: RTCPeerConnection): RTCRtpTransceiver | undefined {
  const audio = pc.getTransceivers().filter(t => t.direction !== 'stopped' && t.receiver.track.kind === 'audio');
  return audio.find(t => t.mid !== null && (t.currentDirection === 'sendrecv' || t.currentDirection === 'sendonly'))
    ?? audio.find(t => t.mid !== null)
    ?? audio[0];
}

// addTransceiver() placeholders are not necessarily reused by a remote offer.
// Attach the microphone to the offered m-line before generating the answer.
export async function prepareAudioAnswer(pc: RTCPeerConnection, stream: MediaStream | null): Promise<void> {
  const audio = pc.getTransceivers().find(t => t.direction !== 'stopped' && t.mid !== null && t.receiver.track.kind === 'audio');
  if (!audio) return;
  audio.direction = 'sendrecv';
  await audio.sender.replaceTrack(stream?.getAudioTracks()[0] ?? null);
}
