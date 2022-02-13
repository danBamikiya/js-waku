import { keccak256, Message } from "js-sha3";

/**
 * Convert input to a Buffer.
 *
 * @deprecated Use `hexToBytes` instead.
 */
export function hexToBuf(hex: string | Buffer | Uint8Array): Buffer {
  if (typeof hex === "string") {
    return Buffer.from(hex.replace(/^0x/i, ""), "hex");
  } else {
    return Buffer.from(hex);
  }
}

/**
 * Convert input to a byte array.
 */
export function hexToBytes(hex: string | Uint8Array): Uint8Array {
  if (typeof hex === "string") {
    const _hex = hex.replace(/^0x/i, "");
    const bytes = [];
    for (let c = 0; c < _hex.length; c += 2)
      bytes.push(parseInt(_hex.substring(c, c + 2), 16));

    return new Uint8Array(bytes);
  }
  return hex;
}

/**
 * Convert input to hex string (no `0x` prefix).
 *
 * @deprecated Use `bytesToHex` instead.
 */
export function bufToHex(buf: Uint8Array | Buffer | ArrayBuffer): string {
  const _buf = Buffer.from(buf);
  return _buf.toString("hex");
}

/**
 * Convert byte array to hex string (no `0x` prefix).
 */
export function bytesToHex(bytes: Uint8Array): string {
  const hex = [];
  for (let i = 0; i < bytes.length; i++) {
    const current = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    hex.push((current >>> 4).toString(16));
    hex.push((current & 0xf).toString(16));
  }
  return hex.join("");
}

/**
 * Compare both inputs, return true if they represent the same byte array.
 */
export function equalByteArrays(
  a: Uint8Array | string,
  b: Uint8Array | string
): boolean {
  let _a: string;
  let _b: string;
  if (typeof a === "string") {
    _a = a.replace(/^0x/i, "").toLowerCase();
  } else {
    _a = bytesToHex(a);
  }

  if (typeof b === "string") {
    _b = b.replace(/^0x/i, "").toLowerCase();
  } else {
    _b = bytesToHex(b);
  }

  return _a === _b;
}

/**
 * Return Keccak-256 of the input.
 */
export function keccak256Buf(message: Message): Buffer {
  return Buffer.from(keccak256.arrayBuffer(message));
}
