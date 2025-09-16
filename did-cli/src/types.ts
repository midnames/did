export interface DidJsonDocument {
    id: string;
    context?: string[];
    "@context"?: string[];
    verificationMethod?: Array<VerificationMethod>;
    assertionMethod?: Array<string | VerificationMethod>;
    authentication?: Array<string | VerificationMethod>;
    keyAgreement?: Array<string | VerificationMethod>;
    capabilityInvocation?: Array<string | VerificationMethod>;
    capabilityDelegation?: Array<string | VerificationMethod>;
    service?: Array<Service>;
    credentials?: Array<Credential>;
    updated?: string;
}

type Controller = string | string[];

enum KeyType {
    EC,
    RSA,
    Oct,
}

enum CurveType {
    Ed25519,
    JubJub,
}

type PublicKeyJwk = {
    kty: KeyType;
    crv: CurveType;
    x: string;
}

export type VerificationMethod = {
    id: string;
    type: string;
    controller: Controller;
    publicKeyJwk?: PublicKeyJwk;
    publicKeyMultibase?: string;
    publicKeyHex?: string;
}

type Service = {
    id: string;
    type: string;
    serviceEndpoint: string;
}

type Credential = {
    data: string;
    publicKeyJwk?: PublicKeyJwk;
    publicKeyMultibase: string;
}