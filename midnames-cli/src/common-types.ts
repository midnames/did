import { Did, type DidPrivateState } from '@midnight-ntwrk/midnight-did-contract';
import type { ImpureCircuitId, MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { DeployedContract, FoundContract } from '@midnight-ntwrk/midnight-js-contracts';

export type DidCircuits = ImpureCircuitId<Did.Contract<DidPrivateState>>;

export const DidPrivateStateId = 'DidPrivateState';

export type DidProviders = MidnightProviders<
  DidCircuits,
  typeof DidPrivateStateId,
  DidPrivateState
>;

export type DidContract = Did.Contract<DidPrivateState>;

export type DeployedDidContract = DeployedContract<DidContract> | FoundContract<DidContract>;

export type PublicKey = Did.PublicKey;

export type Keys = Did.Either<Did.PublicKeyJwk, Did.PublicKeyMultibase >;

export type AllowedUsages = {authentication: boolean,
        assertionMethod: boolean,
        capabilityDelegation: boolean,
        capabilityInvocation: boolean,
        keyAgreement: boolean};

export type VerificationMethodType = Did.VerificationMethodType;