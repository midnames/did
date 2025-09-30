import {
  AllowedUsages,
  CurveType,
  KeyType,
  PublicKey,
  VerificationMethodType,
  Service,
} from "../../contract/src/managed/did/contract/index.cjs";

export function generateDefaultKey(): PublicKey {
  const key: PublicKey = {
    id: "",
    type: VerificationMethodType.Ed25519VerificationKey2020,
    allowedUsages: {
      assertionMethod: false,
      authentication: false,
      capabilityDelegation: false,
      capabilityInvocation: false,
      keyAgreement: false,
    },
    publicKey: {
      is_left: false,
      left: {
        crv: CurveType.Ed25519,
        kty: KeyType.EC,
        x: "",
        y: "",
      },
      right: {
        key: "",
      },
    },
  };
  return key;
}