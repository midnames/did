import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  constructorContext
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  type Ledger,
  ledger,
  type PublicKey,
  type AllowedUsages,
  type Service,
  ActionType,
  VerificationMethodType,
  KeyType,
  CurveType
} from "../src/managed/did/contract/index.cjs";
import { type DidPrivateState, witnesses } from "../src/witnesses.js";
import * as fs from "node:fs";
import path, { dirname } from "node:path";
import { createSampleKey, generateSecretKey } from "../utils/utils.js";

/**
 * DID Contract Simulator for testing DID operations without blockchain deployment
 * Provides methods to test all DID contract circuits in isolation
 */
export class DIDSimulator {
  readonly contract: Contract<DidPrivateState>;
  private circuitContext: CircuitContext<DidPrivateState>;

  constructor(customSecretKey?: Uint8Array) {
    this.contract = new Contract<DidPrivateState>(witnesses);

    // Create initial private state with local secret key
    const localSecretKey = customSecretKey || generateSecretKey();

    const initialPrivateState: DidPrivateState = {
      localSecretKey: localSecretKey
    };

    // Initialize contract state using constructor
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

  /**
   * Get current ledger state
   */
  public getLedger(): Ledger {
    return ledger(this.circuitContext.transactionContext.state);
  }

  /**
   * Get current private state
   */
  public getPrivateState(): DidPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  /**
   * Get contract address for testing
   */
  public getContractAddress(): string {
    return this.circuitContext.transactionContext.address;
  }

  /**
   * Check if DID is active
   */
  public isActive(): boolean {
    return this.getLedger().active;
  }

  /**
   * Get controller public key
   */
  public getControllerPublicKey(): Uint8Array {
    return this.getLedger().controllerPublicKey;
  }

  /**
   * Get all keys in the key ring
   */
  public getKeyRing(): Map<string, PublicKey> {
    const keyRingMap : Map<string, PublicKey> = new Map();
    const keyRing = this.getLedger().keyRing;
    for(const k of keyRing){
      const [id, publicKey] = k;
      keyRingMap.set(id, publicKey);
    }
    return keyRingMap;
  }

  /**
   * Get all services
   */
  public getServices(): Map<string, Service> {
    const servicesMap : Map<string, Service> = new Map();
    const services = this.getLedger().services;
    for(const k of services){
      const [id, service] = k;
      servicesMap.set(id, service);
    }
    return servicesMap;
  }

  /**
   * Check if a key exists in the key ring
   */
  public hasKey(keyId: string): boolean {
    return this.getLedger().keyRing.member(keyId);
  }

  /**
   * Get a specific key from the key ring
   */
  public getKey(keyId: string): PublicKey | undefined {
    try {
      return this.getLedger().keyRing.lookup(keyId);
    } catch {
      return undefined;
    }
  }

  /**
   * Add a key to the DID
   * Tests the addKey circuit
   */
  public addKey(key: PublicKey): void {
    try {
      const result = this.contract.impureCircuits.addKey(
        this.circuitContext,
        key
      );
      this.circuitContext = result.context;
    } catch (error) {
      throw new Error(`Failed to add key: ${error}`);
    }
  }

  /**
   * Remove a key from the DID
   * Tests the removeKey circuit
   */
  public removeKey(keyId: string): void {
    try {
      const result = this.contract.impureCircuits.removeKey(
        this.circuitContext,
        keyId
      );
      this.circuitContext = result.context;
    } catch (error) {
      throw new Error(`Failed to remove key: ${error}`);
    }
  }

  /**
   * Add allowed usage to a key
   * Tests the addAllowedUsage circuit
   */
  public addAllowedUsage(keyId: string, actionType: ActionType): void {
    try {
      const result = this.contract.impureCircuits.addAllowedUsage(
        this.circuitContext,
        keyId,
        actionType
      );
      this.circuitContext = result.context;
    } catch (error) {
      throw new Error(`Failed to add allowed usage: ${error}`);
    }
  }

  /**
   * Remove allowed usage from a key
   * Tests the removeAllowedUsage circuit
   */
  public removeAllowedUsage(keyId: string, actionType: ActionType): void {
    try {
      const result = this.contract.impureCircuits.removeAllowedUsage(
        this.circuitContext,
        keyId,
        actionType
      );
      this.circuitContext = result.context;
    } catch (error) {
      throw new Error(`Failed to remove allowed usage: ${error}`);
    }
  }

  /**
   * Add service
   * Tests the addService circuit
   */
  public addService(service: Service): void {
    try {
      const result = this.contract.impureCircuits.addService(
        this.circuitContext,
        service
      );
      this.circuitContext = result.context;
    } catch (error) {
      throw new Error(`Failed to add service: ${error}`);
    }
  }

  /**
   * Remove service
   * Tests the removeAllowedUsage circuit
   */
  public removeService(serviceId: string): void {
    try {
      const result = this.contract.impureCircuits.removeService(
        this.circuitContext,
        serviceId
      );
      this.circuitContext = result.context;
    } catch (error) {
      throw new Error(`Failed to remove service: ${error}`);
    }
  }

  /**
   * Deactivate the DID
   * Tests the deactivate circuit
   */
  public deactivate(): void {
    try {
      const result = this.contract.impureCircuits.deactivate(
        this.circuitContext
      );
      this.circuitContext = result.context;
    } catch (error) {
      throw new Error(`Failed to deactivate DID: ${error}`);
    }
  }

  /**
   * Reset the simulator state to initial conditions
   */
  public reset(customSecretKey?: Uint8Array): void {
    const localSecretKey = customSecretKey || generateSecretKey();

    const initialPrivateState: DidPrivateState = {
      localSecretKey: localSecretKey
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
}