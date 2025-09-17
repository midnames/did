import {
  AllowedUsages,
  CurveType,
  KeyType,
  PublicKey,
  VerificationMethodType,
  Service
} from "../src/managed/did/contract/index.cjs";

/**
 * Create a sample public key for testing
 */
export function createSampleKey(
  keyId: string,
  keyType: "jwk" | "multibase" = "multibase"
): PublicKey {
  const allowedUsages: AllowedUsages = {
    authentication: false,
    assertionMethod: false,
    keyAgreement: false,
    capabilityInvocation: false,
    capabilityDelegation: false
  };

  if (keyType === "jwk") {
    return {
      id: keyId,
      type: VerificationMethodType.Ed25519VerificationKey2020,
      publicKey: {
        is_left: true,
        left: {
          kty: KeyType.EC,
          crv: CurveType.Ed25519,
          x: BigInt("12345678901234567890")
        },
        right: { key: "" }
      },
      allowedUsages
    };
  } else {
    return {
      id: keyId,
      type: VerificationMethodType.Ed25519VerificationKey2020,
      publicKey: {
        is_left: false,
        left: {
          kty: KeyType.EC,
          crv: CurveType.Ed25519,
          x: 0n
        },
        right: {
          key: "z6MkHaXU2BzXhf8X4n6Q1Q2QJ9CkN5j8L9M2P3R4S5T6U7V8W9X"
        }
      },
      allowedUsages
    };
  }
}

/**
 * Generate a random 32-byte secret key for testing
 */
export function generateSecretKey(): Uint8Array {
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    key[i] = Math.floor(Math.random() * 256);
  }
  return key;
}

/*
 *
 */
export function createNewService(id: string, type: string, endpoint: string) {
  const service: Service = {
    id: id,
    type: type,
    serviceEndpoint: endpoint
  };

  return service;
}

/**
 * Helper method to create a key with specific allowed usages
 */
export function createKeyWithUsages(
  keyId: string,
  usages: Partial<AllowedUsages>,
  keyType: "jwk" | "multibase" = "multibase"
): PublicKey {
  const key = createSampleKey(keyId, keyType);
  key.allowedUsages = {
    authentication: usages.authentication || false,
    assertionMethod: usages.assertionMethod || false,
    keyAgreement: usages.keyAgreement || false,
    capabilityInvocation: usages.capabilityInvocation || false,
    capabilityDelegation: usages.capabilityDelegation || false
  };
  return key;
}
