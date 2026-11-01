export class PaddingLayer {
  private static readonly BUCKETS = [256, 512, 1024, 2048, 4096, 8192]; // Predetermined block sizes

  /**
   * Pads a serialized message into fixed-size buckets with random bytes
   * to mitigate message-size fingerprinting.
   */
  static applyPadding(payload: string): Uint8Array {
    const encoder = new TextEncoder();
    const rawBytes = encoder.encode(payload);

    // Add length prefix (4 bytes = uint32)
    const lengthPrefix = new ArrayBuffer(4);
    new DataView(lengthPrefix).setUint32(0, rawBytes.length, false);

    // Identify target bucket size
    const minRequiredSize = 4 + rawBytes.length; // 4 bytes for length prefix
    let targetSize = this.BUCKETS.find((size) => size >= minRequiredSize);

    // Fallback: If it exceeds the largest bucket, pad to the nearest 1KB chunk
    if (!targetSize) {
      targetSize = Math.ceil(minRequiredSize / 1024) * 1024;
    }

    // Allocate padded array
    const paddedArray = new Uint8Array(targetSize);

    // Copy prefix length (uint32)
    paddedArray.set(new Uint8Array(lengthPrefix), 0);

    // Copy actual payload
    paddedArray.set(rawBytes, 4);

    // Fill remaining bytes with cryptographically secure random values
    // Using simple crypto random for random stuffing
    if (targetSize > minRequiredSize) {
      const paddingBytes = new Uint8Array(targetSize - minRequiredSize);
      crypto.getRandomValues(paddingBytes);
      paddedArray.set(paddingBytes, minRequiredSize);
    }

    return paddedArray;
  }

  /**
   * Strips padding from a decrypted message payload.
   */
  static stripPadding(paddedArray: Uint8Array): string {
    const dataView = new DataView(
      paddedArray.buffer,
      paddedArray.byteOffset,
      paddedArray.byteLength,
    );
    const actualLength = dataView.getUint32(0, false); // Length is stored in big endian

    const rawPayload = paddedArray.slice(4, 4 + actualLength);
    const decoder = new TextDecoder();
    return decoder.decode(rawPayload);
  }
}
