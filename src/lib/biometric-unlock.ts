/**
 * Desbloqueio biométrico do cofre via Windows Hello / WebAuthn (extensão PRF).
 *
 * Modelo de segurança (mantém zero-knowledge):
 * - No cadastro, registramos uma credencial de plataforma (Windows Hello / Touch ID / etc.)
 *   e obtemos um segredo derivado dela via extensão PRF.
 * - Usamos esse segredo (32 bytes de alta entropia) como chave AES-256 para CIFRAR a senha
 *   do cofre, guardando apenas o blob cifrado no localStorage.
 * - No desbloqueio, a verificação biométrica devolve o mesmo segredo PRF, que decifra a senha.
 * O blob guardado é inútil sem a biometria daquele dispositivo. A senha continua como fallback.
 */

import { encrypt, decrypt, saltToBase64, base64ToSalt } from "@/lib/crypto";

interface BioBlob {
  credentialId: string; // base64 do rawId
  prfSalt: string; // base64 do salt usado no PRF
  cipher: string; // senha do cofre cifrada (AES-GCM, IV embutido)
  createdAt: number;
}

const keyFor = (namespace: string) => `investpro_biometric_${namespace || "default"}`;

// Reaproveita os conversores base64 de crypto.ts (chunked, seguros para arrays grandes).
const bufToB64 = (buf: ArrayBuffer | Uint8Array): string =>
  saltToBase64(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
const b64ToBytes = (b64: string): Uint8Array => base64ToSalt(b64);

/** O dispositivo/navegador tem um autenticador de plataforma (biometria) disponível? */
export async function isBiometricSupported(): Promise<boolean> {
  try {
    if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
    if (!window.isSecureContext) return false; // WebAuthn exige contexto seguro (https/localhost)
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Já existe biometria cadastrada para este namespace neste dispositivo? */
export function hasBiometricEnrolled(namespace: string): boolean {
  try {
    return !!localStorage.getItem(keyFor(namespace));
  } catch {
    return false;
  }
}

/** Remove o cadastro biométrico deste dispositivo (não afeta a senha do cofre). */
export function disableBiometric(namespace: string): void {
  try {
    localStorage.removeItem(keyFor(namespace));
  } catch {
    /* noop */
  }
}

async function aesKeyFromPrf(prf: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", prf, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Executa uma asserção WebAuthn para obter o segredo PRF da credencial. */
async function evalPrf(credentialIdB64: string, prfSalt: Uint8Array): Promise<ArrayBuffer | undefined> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: location.hostname,
      allowCredentials: [
        { type: "public-key", id: b64ToBytes(credentialIdB64), transports: ["internal"] },
      ],
      userVerification: "required",
      timeout: 60000,
      // PRF ainda não está na lib DOM padrão; usamos cast.
      extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  const results = (assertion?.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } })
    ?.prf?.results?.first;
  return results;
}

/**
 * Cadastra a biometria para desbloquear o cofre. Requer a senha atual (cofre aberto).
 * Lança "PRF_UNSUPPORTED" se o navegador/autenticador não suportar a extensão PRF.
 */
export async function enrollBiometric(namespace: string, password: string): Promise<void> {
  const prfSalt = crypto.getRandomValues(new Uint8Array(32));
  const userId = new TextEncoder().encode((namespace || "default").slice(0, 64));

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "InvestPro Vault", id: location.hostname },
      user: { id: userId, name: `vault-${namespace || "default"}`, displayName: "InvestPro Vault" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60000,
      extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!cred) throw new Error("Não foi possível criar a credencial biométrica");

  const credentialId = bufToB64(cred.rawId);

  // Alguns navegadores devolvem o PRF já no create(); outros exigem uma asserção.
  let prfOut = (cred.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } })?.prf
    ?.results?.first;
  if (!prfOut) {
    prfOut = await evalPrf(credentialId, prfSalt);
  }
  if (!prfOut) throw new Error("PRF_UNSUPPORTED");

  const key = await aesKeyFromPrf(prfOut);
  const cipher = await encrypt(password, key);

  const blob: BioBlob = { credentialId, prfSalt: bufToB64(prfSalt), cipher, createdAt: Date.now() };
  localStorage.setItem(keyFor(namespace), JSON.stringify(blob));
}

/**
 * Desbloqueia via biometria. Retorna a senha do cofre (para chamar unlockVault) ou null
 * se não houver cadastro. Lança em caso de cancelamento/erro do WebAuthn.
 */
export async function unlockWithBiometric(namespace: string): Promise<string | null> {
  const raw = localStorage.getItem(keyFor(namespace));
  if (!raw) return null;

  const blob = JSON.parse(raw) as BioBlob;
  const prfOut = await evalPrf(blob.credentialId, b64ToBytes(blob.prfSalt));
  if (!prfOut) throw new Error("PRF_UNSUPPORTED");

  const key = await aesKeyFromPrf(prfOut);
  return decrypt(blob.cipher, key);
}
