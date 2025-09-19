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
  type Service,
  ActionType
} from "../src/managed/did/contract/index.cjs";
import { type DidPrivateState, witnesses } from "../src/witnesses.js";
import { generateSecretKey } from "../utils/utils.js";
import { Operation, OperationType } from "../../did-cli/src/common-types.js";
import { Did } from "@midnight-ntwrk/midnight-did-contract";
import { generateDefaultKey } from "../../did-cli/utils/utils.js";
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
    const keyRingMap: Map<string, PublicKey> = new Map();
    const keyRing = this.getLedger().keyRing;
    for (const k of keyRing) {
      const [id, publicKey] = k;
      keyRingMap.set(id, publicKey);
    }
    return keyRingMap;
  }

  /**
   * Get all services
   */
  public getServices(): Map<string, Service> {
    const servicesMap: Map<string, Service> = new Map();
    const services = this.getLedger().services;
    for (const k of services) {
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
      const operation: Operation = {
        operationType: Did.OperationType.AddKey,

        addKeyArgs: { is_some: true, value: { key: key } },
        addAllowedUsageArgs: {
          is_some: false,
          value: { keyId: "", actionType: ActionType.AssertionMethod }
        },
        removeKeyArgs: { is_some: false, value: { keyId: "" } },
        removeAllowedUsageArgs: {
          is_some: false,
          value: { keyId: "", actionType: ActionType.AssertionMethod }
        },
        addServiceArgs: {
          is_some: false,
          value: { service: { id: "", type: "", serviceEndpoint: "" } }
        },
        removeServiceArgs: { is_some: false, value: { serviceId: "" } }
      };

      const result = this.contract.impureCircuits.applyOperation(
        this.circuitContext,
        operation
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
      const operation: Operation = {
        operationType: Did.OperationType.RemoveKey,

        addKeyArgs: { is_some: false, value: { key: generateDefaultKey() } },
        removeKeyArgs: { is_some: true, value: { keyId: keyId } },
        addAllowedUsageArgs: {
          is_some: false,
          value: { keyId: "", actionType: ActionType.AssertionMethod }
        },
        removeAllowedUsageArgs: {
          is_some: false,
          value: { keyId: "", actionType: ActionType.AssertionMethod }
        },
        addServiceArgs: {
          is_some: false,
          value: { service: { id: "", type: "", serviceEndpoint: "" } }
        },
        removeServiceArgs: { is_some: false, value: { serviceId: "" } }
      };

      const result = this.contract.impureCircuits.applyOperation(
        this.circuitContext,
        operation
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
      const operation: Operation = {
        operationType: Did.OperationType.AddAllowedUsage,

        addKeyArgs: { is_some: false, value: { key: generateDefaultKey() } },
        removeKeyArgs: { is_some: false, value: { keyId: "keyId" } },
        addAllowedUsageArgs: {
          is_some: true,
          value: { keyId: keyId, actionType: actionType }
        },
        removeAllowedUsageArgs: {
          is_some: false,
          value: { keyId: "", actionType: ActionType.AssertionMethod }
        },
        addServiceArgs: {
          is_some: false,
          value: {
            service: {
              id: "",
              type: "",
              serviceEndpoint: ""
            }
          }
        },
        removeServiceArgs: { is_some: false, value: { serviceId: "" } }
      };

      const result = this.contract.impureCircuits.applyOperation(
        this.circuitContext,
        operation
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
      const operation: Operation = {
        operationType: Did.OperationType.AddAllowedUsage,

        addKeyArgs: { is_some: false, value: { key: generateDefaultKey() } },
        removeKeyArgs: { is_some: false, value: { keyId: "keyId" } },
        addAllowedUsageArgs: {
          is_some: false,
          value: { keyId: "", actionType: ActionType.AssertionMethod }
        },
        removeAllowedUsageArgs: {
          is_some: true,
          value: { keyId: keyId, actionType: actionType }
        },
        addServiceArgs: {
          is_some: false,
          value: { service: { id: "", type: "", serviceEndpoint: "" } }
        },
        removeServiceArgs: { is_some: false, value: { serviceId: "" } }
      };

      const result = this.contract.impureCircuits.applyOperation(
        this.circuitContext,
        operation
      );
      this.circuitContext = result.context;
    } catch (error) {
      throw new Error(`Failed to remove allowed usage: ${error}`);
    }

    /**
     * Add service
     * Tests the addService circuit
     */
  }
  public addService(service: Service): void {
    try {
      const operation: Operation = {
        operationType: Did.OperationType.AddService,

        addKeyArgs: { is_some: false, value: { key: generateDefaultKey() } },
        removeKeyArgs: { is_some: false, value: { keyId: "keyId" } },
        removeAllowedUsageArgs: {
          is_some: false,
          value: { keyId: "", actionType: ActionType.AssertionMethod }
        },
        addAllowedUsageArgs: {
          is_some: false,
          value: { keyId: "", actionType: ActionType.AssertionMethod }
        },
        addServiceArgs: {
          is_some: true,
          value: {
            service: {
              id: service.id,
              type: service.type,
              serviceEndpoint: service.serviceEndpoint
            }
          }
        },
        removeServiceArgs: { is_some: false, value: { serviceId: "" } }
      };

      const result = this.contract.impureCircuits.applyOperation(
        this.circuitContext,
        operation
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
      const operation: Operation = {
        operationType: Did.OperationType.RemoveService,

        addKeyArgs: { is_some: false, value: { key: generateDefaultKey() } },
        removeKeyArgs: { is_some: false, value: { keyId: "keyId" } },
        removeAllowedUsageArgs: {
          is_some: false,
          value: { keyId: "", actionType: ActionType.AssertionMethod }
        },
        addAllowedUsageArgs: {
          is_some: false,
          value: { keyId: "", actionType: ActionType.AssertionMethod }
        },
        addServiceArgs: {
          is_some: false,
          value: {
            service: {
              id: "",
              type: "",
              serviceEndpoint: ""
            }
          }
        },
        removeServiceArgs: { is_some: true, value: { serviceId: serviceId } }
      };

      const result = this.contract.impureCircuits.applyOperation(
        this.circuitContext,
        operation
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
      const operation: Operation = {
        operationType: Did.OperationType.Deactivate,

        addKeyArgs: { is_some: false, value: { key: generateDefaultKey() } },
        removeKeyArgs: { is_some: false, value: { keyId: "keyId" } },
        removeAllowedUsageArgs: {
          is_some: false,
          value: { keyId: "", actionType: ActionType.AssertionMethod }
        },
        addAllowedUsageArgs: {
          is_some: false,
          value: { keyId: "", actionType: ActionType.AssertionMethod }
        },
        addServiceArgs: {
          is_some: false,
          value: { service: { id: "", type: "", serviceEndpoint: "" } }
        },
        removeServiceArgs: { is_some: false, value: { serviceId: "" } }
      };

      const result = this.contract.impureCircuits.applyOperation(
        this.circuitContext,
        operation
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
