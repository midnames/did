import * as fs from "fs";
import * as path from "path";
import type { DidJsonDocument } from "../../midnames-cli/src/types.js";
import { ActionType, AllowedUsages, CurveType, KeyType, PublicKey, VerificationMethodType } from "../src/managed/did/contract/index.cjs";


/**
 * Parse a DID JSON file and return the parsed document
 */
export function parseJsonDID(filePath: string): DidJsonDocument {
  try {
    const json_path = path.join(__dirname, "..", "test", filePath);
    const fileContent = fs.readFileSync(json_path, 'utf-8');
    const didDocument: DidJsonDocument = JSON.parse(fileContent);

    // Basic validation
    if (!didDocument.id) {
      throw new Error("DID document must have an 'id' field");
    }
    if (!didDocument["@context"]) {
      throw new Error("DID document must have a '@context' field");
    }

    return didDocument;
  } catch (error) {
    console.log(__dirname);
    throw new Error(`Failed to parse DID JSON file: ${error}`);
  }
}

/**
 * Write a parsed DID document to the contract by adding keys and setting usages
 */
export function writeDidToContract(didDocument: DidJsonDocument): void {
  try {
    // Process verification methods first
    if (didDocument.verificationMethod) {
      for (const verificationMethod of didDocument.verificationMethod) {
        const keyId = extractKeyId(verificationMethod.id);
        const publicKey = createPublicKeyFromVerificationMethod(verificationMethod, keyId);
        simulator.addKey(publicKey);
      }
    }

    // Process authentication methods (embedded ones)
    if (didDocument.authentication) {
      for (const auth of didDocument.authentication) {
        if (typeof auth === 'object') {
          // Embedded authentication method
          const keyId = extractKeyId(auth.id);
          const publicKey = createPublicKeyFromVerificationMethod(auth, keyId);
          simulator.addKey(publicKey);
          this.addAllowedUsage(keyId, ActionType.Authentication);
        } else {
          // Reference to existing verification method
          const keyId = extractKeyId(auth);
          this.addAllowedUsage(keyId, ActionType.Authentication);
        }
      }
    }

    // // Process assertion methods
    // if (didDocument.assertionMethod) {
    //   for (const assertionMethod of didDocument.assertionMethod) {
    //     const keyId = extractKeyId(assertionMethod);
    //     this.addAllowedUsage(keyId, ActionType.AssertionMethod);
    //   }
    // }

    // // Process key agreement
    // if (didDocument.keyAgreement) {
    //   for (const keyAgreement of didDocument.keyAgreement) {
    //     const keyId = extractKeyId(keyAgreement);
    //     this.addAllowedUsage(keyId, ActionType.KeyAgreement);
    //   }
    // }

    // // Process capability invocation
    // if (didDocument.capabilityInvocation) {
    //   for (const capabilityInvocation of didDocument.capabilityInvocation) {
    //     const keyId = extractKeyId(capabilityInvocation);
    //     this.addAllowedUsage(keyId, ActionType.CapabilityInvocation);
    //   }
    // }

    // // Process capability delegation
    // if (didDocument.capabilityDelegation) {
    //   for (const capabilityDelegation of didDocument.capabilityDelegation) {
    //     const keyId = extractKeyId(capabilityDelegation);
    //     this.addAllowedUsage(keyId, ActionType.CapabilityDelegation);
    //   }
    // }

  } catch (error) {
    throw new Error(`Failed to write DID to contract: ${error}`);
  }
}

/**
 * Retrieve DID data from contract and format as DID document
 */
export function getDidFromContract(): DidJsonDocument {
  const contractAddress = this.getContractAddress();
  const keyRing = this.getKeyRing();

  const verificationMethod: Array<any> = [];
  const authentication: Array<string> = [];
  const assertionMethod: Array<string> = [];
  const keyAgreement: Array<string> = [];
  const capabilityInvocation: Array<string> = [];
  const capabilityDelegation: Array<string> = [];

  // Process all keys in the keyring
  for (const [keyId, publicKey] of keyRing) {
    const fullKeyId = `did:midnames:${contractAddress}#${keyId}`;

    // Add to verification methods
    const verificationMethodEntry: any = {
      id: fullKeyId,
      type: this.getVerificationMethodTypeString(publicKey.type),
      controller: `did:midnames:${contractAddress}`
    };

    if (publicKey.publicKey.is_left) {
      // JWK format
      verificationMethodEntry.publicKeyJwk = {
        kty: this.getKeyTypeString(publicKey.publicKey.left.kty),
        crv: this.getCurveTypeString(publicKey.publicKey.left.crv),
        x: publicKey.publicKey.left.x.toString()
      };
    } else {
      // Multibase format
      verificationMethodEntry.publicKeyMultibase = publicKey.publicKey.right.key;
    }

    verificationMethod.push(verificationMethodEntry);

    // Add to appropriate usage arrays based on allowed usages
    if (publicKey.allowedUsages.authentication) {
      authentication.push(fullKeyId);
    }
    if (publicKey.allowedUsages.assertionMethod) {
      assertionMethod.push(fullKeyId);
    }
    if (publicKey.allowedUsages.keyAgreement) {
      keyAgreement.push(fullKeyId);
    }
    if (publicKey.allowedUsages.capabilityInvocation) {
      capabilityInvocation.push(fullKeyId);
    }
    if (publicKey.allowedUsages.capabilityDelegation) {
      capabilityDelegation.push(fullKeyId);
    }
  }

  return {
    "@context": ["https://www.w3.org/ns/did/v1"],
      id: `did:midnames:${contractAddress}`,
    verificationMethod,
    ...(authentication.length > 0 && { authentication }),
    ...(assertionMethod.length > 0 && { assertionMethod }),
    ...(keyAgreement.length > 0 && { keyAgreement }),
    ...(capabilityInvocation.length > 0 && { capabilityInvocation }),
    ...(capabilityDelegation.length > 0 && { capabilityDelegation })
  };
}

/**
 * Helper method to extract key ID from full DID key reference
 */
function extractKeyId(fullKeyId: string): string {
  const parts = fullKeyId.split('#');
  return parts.length > 1 ? parts[1] : fullKeyId;
}

/**
 * Helper method to create PublicKey from verification method
 */
function createPublicKeyFromVerificationMethod(verificationMethod: any, keyId: string): PublicKey {
  const allowedUsages: AllowedUsages = {
    authentication: false,
    assertionMethod: false,
    keyAgreement: false,
    capabilityInvocation: false,
    capabilityDelegation: false
  };

  if (verificationMethod.publicKeyJwk) {
    // Handle JWK format
    return {
      id: keyId,
      type: VerificationMethodType.Ed25519VerificationKey2020,
      publicKey: {
        is_left: true,
        left: {
          kty: KeyType.EC,
          crv: CurveType.Ed25519,
          x: BigInt("12345678901234567890") // Sample value for testing
        },
      right: { key: "" }
      },
      allowedUsages
    };
  } else if (verificationMethod.publicKeyMultibase) {
    // Handle multibase format
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
          key: verificationMethod.publicKeyMultibase
        }
      },
      allowedUsages
    };
  } else {
    throw new Error(`Unsupported key format in verification method: ${keyId}. Only publicKeyJwk and publicKeyMultibase are supported.`);
  }
}

/**
 * Helper methods for type conversion
 */
function getVerificationMethodTypeString(type: VerificationMethodType): string {
  return VerificationMethodType[type];
}

function getKeyTypeString(keyType: KeyType): string {
  return KeyType[keyType];
}

function getCurveTypeString(curveType: CurveType): string {
  return CurveType[curveType];
}
