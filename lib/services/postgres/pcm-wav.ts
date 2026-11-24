// RIFF/WAVE with integer 16-bit PCM. Its data chunk contains interleaved sample frames.
export function inspectPcmWav(bytes: Buffer) {
  if (bytes.length < 46 || bytes.toString("latin1",0,4) !== "RIFF" ||
      bytes.readUInt32LE(4) !== bytes.length-8 || bytes.toString("latin1",8,12) !== "WAVE") return null;
  let channels = 0, sampleRate = 0, frames = 0, offset = 12;
  while (offset < bytes.length) {
    if (offset+8 > bytes.length) return null;
    const type = bytes.toString("latin1",offset,offset+4), size = bytes.readUInt32LE(offset+4);
    const start = offset+8;
    offset = start+size+(size%2);
    if (offset > bytes.length) return null;
    if (type === "fmt ") {
      if (channels || size !== 16 || bytes.readUInt16LE(start) !== 1 || bytes.readUInt16LE(start+14) !== 16) return null;
      channels = bytes.readUInt16LE(start+2);
      sampleRate = bytes.readUInt32LE(start+4);
      if ((channels !== 1 && channels !== 2) || sampleRate < 8000 || sampleRate > 192000 ||
          bytes.readUInt16LE(start+12) !== channels*2 || bytes.readUInt32LE(start+8) !== sampleRate*channels*2) return null;
    } else if (type === "data") {
      if (!channels || frames || !size || size%(channels*2)) return null;
      frames = size/(channels*2);
    }
  }
  return frames ? { channels,sampleRate,frames } : null;
}
