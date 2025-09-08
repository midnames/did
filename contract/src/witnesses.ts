import { WitnessContext } from "@midnight-ntwrk/compact-runtime";
import { Ledger } from "./managed/matching-pennies/contract/index.cjs";

export type MatchingPenniesPrivateState = {
  readonly playerId: Uint8Array;
  readonly timestamp: bigint;
};

export const createMatchingPenniesSecretState = (
  playerId: Uint8Array,
  timestamp: bigint
): MatchingPenniesPrivateState => ({
  playerId,
  timestamp
});

export const witnesses = {
  playerId: ({
    privateState
  }: WitnessContext<Ledger, MatchingPenniesPrivateState>): [
    MatchingPenniesPrivateState,
    Uint8Array
  ] => [privateState, privateState.playerId],
  timestamp: ({
    privateState
  }: WitnessContext<Ledger, MatchingPenniesPrivateState>): [
    MatchingPenniesPrivateState,
    bigint
  ] => [privateState, privateState.timestamp]
};
