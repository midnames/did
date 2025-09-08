import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  constructorContext
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  type Ledger,
  ledger
} from "../managed/matching-pennies/contract/index.cjs";
import { type MatchingPenniesPrivateState, witnesses } from "../witnesses.js";

export class MatchingPenniesSimulator {
  readonly contract: Contract<MatchingPenniesPrivateState>;
  private circuitContext: CircuitContext<MatchingPenniesPrivateState>;

  constructor() {
    this.contract = new Contract<MatchingPenniesPrivateState>(witnesses);

    const defaultPlayerId = new Uint8Array(32);
    defaultPlayerId.set([1], 31);

    const defaultTimestamp = BigInt(Math.floor(Date.now() / 1000));

    const initialPrivateState: MatchingPenniesPrivateState = {
      playerId: defaultPlayerId,
      timestamp: defaultTimestamp
    };

    const initialState = this.contract.initialState(
      constructorContext(initialPrivateState, "0".repeat(64))
    );

    this.circuitContext = {
      currentPrivateState: initialState.currentPrivateState,
      currentZswapLocalState: initialState.currentZswapLocalState,
      originalState: initialState.currentContractState,
      transactionContext: new QueryContext(
        initialState.currentContractState.data,
        sampleContractAddress()
      )
    };
  }

  public getLedger(): Ledger {
    return ledger(this.circuitContext.transactionContext.state);
  }

  public getPrivateState(): MatchingPenniesPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  public setPlayerId(playerId: Uint8Array): void {
    this.circuitContext.currentPrivateState = {
      ...this.circuitContext.currentPrivateState,
      playerId
    };
  }

  public setTimestamp(timestamp: bigint): void {
    this.circuitContext.currentPrivateState = {
      ...this.circuitContext.currentPrivateState,
      timestamp
    };
  }

  public commitJugada(choice: boolean, secretKey: Bytes<32>): void {
    const result = this.contract.impureCircuits.commitJugada(
      this.circuitContext,
      choice,
      secretKey
    );
    this.circuitContext = result.context;
  }

  public revealJugada(choice: boolean, secretKey: Bytes<32>): void {
    const result = this.contract.impureCircuits.revealJugada(
      this.circuitContext,
      choice,
      secretKey
    );
    this.circuitContext = result.context;
  }

  public resolverPartida(): void {
    const result = this.contract.impureCircuits.resolverPartida(
      this.circuitContext
    );
    this.circuitContext = result.context;
  }
}
