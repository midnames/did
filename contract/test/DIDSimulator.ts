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
  ActionType,
  VerificationMethodType,
  KeyType,
  CurveType
} from "../src/managed/did/contract/index.cjs";
import { type DidPrivateState, witnesses } from "../src/witnesses.js";
import * as fs from "node:fs";
import path, { dirname } from "node:path";

/**
 * DID JSON Document interface for parsing
 */
export interface DidJsonDocument {
  "@context": string[];
  id: string;
  verificationMethod?: Array<{
    id: string;
    type: string;
    controller: string;
    publicKeyMultibase?: string;
    publicKeyJwk?: {
      kty: string;
      crv: string;
      x: string;
    };
  }>;
  authentication?: Array<string | {
    id: string;
    type: string;
    controller: string;
    publicKeyMultibase?: string;
  }>;
  assertionMethod?: string[];
  keyAgreement?: string[];
  capabilityInvocation?: string[];
  capabilityDelegation?: string[];
  service?: Array<{
    id: string;
    type: string;
    serviceEndpoint: string;
  }>;
  updated?: string;
}

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
    const localSecretKey = customSecretKey || this.generateSecretKey();
    
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
   * Generate a random 32-byte secret key for testing
   */
  private generateSecretKey(): Uint8Array {
    const key = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      key[i] = Math.floor(Math.random() * 256);
    }
    return key;
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
   * Create a sample public key for testing
   */
  public createSampleKey(keyId: string, keyType: "jwk" | "multibase" = "multibase"): PublicKey {
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
    const localSecretKey = customSecretKey || this.generateSecretKey();
    
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

  /**
   * Create a simulator with unauthorized controller for testing access control
   */
  public static createUnauthorizedSimulator(): DIDSimulator {
    const unauthorizedKey = new Uint8Array(32);
    // Fill with different pattern to ensure it's different from authorized keys
    for (let i = 0; i < 32; i++) {
      unauthorizedKey[i] = 255 - (i % 256);
    }
    return new DIDSimulator(unauthorizedKey);
  }

  /**
   * Helper method to create a key with specific allowed usages
   */
  public createKeyWithUsages(
    keyId: string, 
    usages: Partial<AllowedUsages>,
    keyType: "jwk" | "multibase" = "multibase"
  ): PublicKey {
    const key = this.createSampleKey(keyId, keyType);
    key.allowedUsages = {
      authentication: usages.authentication || false,
      assertionMethod: usages.assertionMethod || false,
      keyAgreement: usages.keyAgreement || false,
      capabilityInvocation: usages.capabilityInvocation || false,
      capabilityDelegation: usages.capabilityDelegation || false
    };
    return key;
  }

  /**
   * Get detailed state for debugging
   */
  public getDetailedState(): {
    active: boolean;
    controllerPublicKey: Uint8Array;
    keyRingSize: number;
    keys: Array<{keyId: string, type: number, usages: AllowedUsages}>;
  } {
    const ledgerState = this.getLedger();
    const keyRing = ledgerState.keyRing;
    const keys: Array<{keyId: string, type: number, usages: AllowedUsages}> = [];
    
    for (const [keyId, publicKey] of keyRing) {
      keys.push({
        keyId,
        type: publicKey.type,
        usages: publicKey.allowedUsages
      });
    }

    return {
      active: ledgerState.active,
      controllerPublicKey: ledgerState.controllerPublicKey,
      keyRingSize: Number(keyRing.size()),
      keys
    };
  }

  /**
   * Parse a DID JSON file and return the parsed document
   */
  public parseJsonDID(filePath: string): DidJsonDocument {
    try {
      const json_path = path.join(__dirname, filePath);
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
  public writeDidToContract(didDocument: DidJsonDocument): void {
    try {
      // Process verification methods first
      if (didDocument.verificationMethod) {
        for (const verificationMethod of didDocument.verificationMethod) {
          const keyId = this.extractKeyId(verificationMethod.id);
          const publicKey = this.createPublicKeyFromVerificationMethod(verificationMethod, keyId);
          this.addKey(publicKey);
        }
      }

      // Process authentication methods (embedded ones)
      if (didDocument.authentication) {
        for (const auth of didDocument.authentication) {
          if (typeof auth === 'object') {
            // Embedded authentication method
            const keyId = this.extractKeyId(auth.id);
            const publicKey = this.createPublicKeyFromVerificationMethod(auth, keyId);
            this.addKey(publicKey);
            this.addAllowedUsage(keyId, ActionType.Authentication);
          } else {
            // Reference to existing verification method
            const keyId = this.extractKeyId(auth);
            this.addAllowedUsage(keyId, ActionType.Authentication);
          }
        }
      }

      // Process assertion methods
      if (didDocument.assertionMethod) {
        for (const assertionMethod of didDocument.assertionMethod) {
          const keyId = this.extractKeyId(assertionMethod);
          this.addAllowedUsage(keyId, ActionType.AssertionMethod);
        }
      }

      // Process key agreement
      if (didDocument.keyAgreement) {
        for (const keyAgreement of didDocument.keyAgreement) {
          const keyId = this.extractKeyId(keyAgreement);
          this.addAllowedUsage(keyId, ActionType.KeyAgreement);
        }
      }

      // Process capability invocation
      if (didDocument.capabilityInvocation) {
        for (const capabilityInvocation of didDocument.capabilityInvocation) {
          const keyId = this.extractKeyId(capabilityInvocation);
          this.addAllowedUsage(keyId, ActionType.CapabilityInvocation);
        }
      }

      // Process capability delegation
      if (didDocument.capabilityDelegation) {
        for (const capabilityDelegation of didDocument.capabilityDelegation) {
          const keyId = this.extractKeyId(capabilityDelegation);
          this.addAllowedUsage(keyId, ActionType.CapabilityDelegation);
        }
      }

    } catch (error) {
      throw new Error(`Failed to write DID to contract: ${error}`);
    }
  }

  /**
   * Retrieve DID data from contract and format as DID document
   */
  public getDidFromContract(): DidJsonDocument {
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
  private extractKeyId(fullKeyId: string): string {
    const parts = fullKeyId.split('#');
    return parts.length > 1 ? parts[1] : fullKeyId;
  }

  /**
   * Helper method to create PublicKey from verification method
   */
  private createPublicKeyFromVerificationMethod(verificationMethod: any, keyId: string): PublicKey {
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
  private getVerificationMethodTypeString(type: VerificationMethodType): string {
    return VerificationMethodType[type];
  }

  private getKeyTypeString(keyType: KeyType): string {
    return KeyType[keyType];
  }

  private getCurveTypeString(curveType: CurveType): string {
    return CurveType[curveType];
  }
}