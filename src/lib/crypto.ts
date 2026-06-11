/**
 * Client-side encryption utilities using AES-256-GCM
 * Zero-knowledge architecture: all encryption happens locally
 */

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;

/**
 * Converte bytes para base64 em blocos. Usar `String.fromCharCode(...bytes)` direto
 * estoura a pilha ("Maximum call stack size exceeded") quando o array é grande
 * (ex.: blob criptografado de uma importação em massa).
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // 32KB por bloco
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Converte uma string base64 para Uint8Array sem alocar strings intermediárias.
 * A abordagem `.split('').map(charCodeAt)` cria um array com N objetos string
 * (um por byte), causando Out-of-Memory em payloads grandes.
 */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Derives an encryption key from user password using PBKDF2
 */
export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts data using AES-256-GCM
 */
export async function encrypt(data: string, key: CryptoKey): Promise<string> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  
  const encryptedData = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoder.encode(data)
  );

  // Combine IV + encrypted data for storage
  const combined = new Uint8Array(iv.length + encryptedData.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encryptedData), iv.length);

  return bytesToBase64(combined);
}

/**
 * Decrypts data using AES-256-GCM
 */
export async function decrypt(encryptedString: string, key: CryptoKey): Promise<string> {
  const combined = base64ToBytes(encryptedString);

  const iv = combined.slice(0, IV_LENGTH);
  const data = combined.slice(IV_LENGTH);

  const decryptedData = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    data
  );

  return new TextDecoder().decode(decryptedData);
}

/**
 * Generates a random salt for key derivation
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

/**
 * Converts Uint8Array to base64 for storage
 */
export function saltToBase64(salt: Uint8Array): string {
  return bytesToBase64(salt);
}

/**
 * Converts base64 back to Uint8Array
 */
export function base64ToSalt(base64: string): Uint8Array {
  return base64ToBytes(base64);
}

/**
 * Generates a secure random encryption key for first-time setup
 */
export function generateSecurePassword(): string {
  const array = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...array));
}
