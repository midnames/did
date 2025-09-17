import { WitnessContext } from "@midnight-ntwrk/compact-runtime";
import { Ledger } from "./managed/did/contract/index.cjs";

export type DidPrivateState = {
  readonly localSecretKey: Uint8Array;
};

export const createDidSecretState = (
  localSecretKey: Uint8Array
): DidPrivateState => ({
  localSecretKey
});

export const witnesses = {
  localSecretKey: ({
    privateState
  }: WitnessContext<Ledger, DidPrivateState>): [
    DidPrivateState,
    Uint8Array
  ] => [privateState, privateState.localSecretKey]
};
