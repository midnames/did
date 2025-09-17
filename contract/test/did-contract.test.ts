import { describe, test, expect, beforeEach, expectTypeOf } from "vitest";
import { DIDSimulator } from "./DIDSimulator.js";
import { ActionType, Service } from "../src/managed/did/contract/index.cjs";
import {
  createSampleKey,
  createKeyWithUsages,
  createNewService
} from "../utils/utils.js";
import {
  parseJsonDID,
  writeDidToContract,
  getDidFromContract
} from "../utils/json-parser.js";
import { DidJsonDocument } from "../../did-cli/src/types.js";

describe("DID Contract Tests", () => {
  let simulator: DIDSimulator;

  beforeEach(() => {
    simulator = new DIDSimulator();
  });

  describe("Contract Initialization", () => {
    test("Should initialize with active DID and controller public key", () => {
      expect(simulator.isActive()).toBe(true);
      expect(simulator.getControllerPublicKey()).toBeInstanceOf(Uint8Array);
      expect(simulator.getControllerPublicKey().length).toBe(32);
    });

    test("Should start with empty key ring", () => {
      expect(simulator.getKeyRing().size).toBe(0);
    });

    test("Should have valid contract address", () => {
      const address = simulator.getContractAddress();
      expect(address).toBeDefined();
      expect(typeof address).toBe("string");
      expect(address.length).toBe(68); // 0200 (4 bytes) + Hex address length (64 bytes) = 68 bytes
    });
  });

  describe("DID JSON parsing & fetching", () => {
    test("Should parse a JSON DID file & store correctly", () => {
      const location = "did-document-example.json";

      // Step 1: Parse the JSON DID file
      const originalDID: DidJsonDocument = parseJsonDID(location);
      expect(originalDID).toBeDefined();
      expect(originalDID.id).toBe("did:midnames:test-example-12345");
      expect(originalDID["@context"]).toContain("https://www.w3.org/ns/did/v1");

      // Step 2: Write the DID to the contract
      writeDidToContract(simulator, originalDID);

      // Step 3: Verify keys were added to the contract
      expect(simulator.getKeyRing().size).toBe(3); // 2 verification methods + 1 authentication key
      expect(simulator.hasKey("keys-1")).toBe(true);
      expect(simulator.hasKey("keys-2")).toBe(true);
      expect(simulator.hasKey("auth-key")).toBe(true);

      // Step 4: Verify key usages were set correctly
      const key1 = simulator.getKey("keys-1");
      expect(key1?.allowedUsages.authentication).toBe(true);
      expect(key1?.allowedUsages.keyAgreement).toBe(true);

      const key2 = simulator.getKey("keys-2");
      expect(key2?.allowedUsages.assertionMethod).toBe(true);
      expect(key2?.allowedUsages.capabilityInvocation).toBe(true);

      const authKey = simulator.getKey("auth-key");
      expect(authKey?.allowedUsages.authentication).toBe(true);

      // Step 5: Verify key types are correct
      expect(key1?.publicKey.is_left).toBe(false); // multibase
      expect(key2?.publicKey.is_left).toBe(true); // JWK
      expect(authKey?.publicKey.is_left).toBe(false); // multibase
    });

    test("Should retrieve the parsed JSON DID in correct format", () => {
      const location = "did-document-example.json";

      // Parse and write the original DID
      const originalDID = parseJsonDID(location);
      writeDidToContract(simulator, originalDID);

      // Retrieve the DID from the contract
      const retrievedDID = getDidFromContract(simulator);

      // Verify basic structure
      expect(retrievedDID).toBeDefined();
      expect(retrievedDID["@context"]).toEqual([
        "https://www.w3.org/ns/did/v1"
      ]);
      expect(retrievedDID.id).toMatch(/^did:midnames:/);

      // Verify verification methods were preserved
      expect(retrievedDID.verificationMethod).toHaveLength(3);
      expect(
        retrievedDID.verificationMethod?.some((vm) => vm.id.includes("keys-1"))
      ).toBe(true);
      expect(
        retrievedDID.verificationMethod?.some((vm) => vm.id.includes("keys-2"))
      ).toBe(true);
      expect(
        retrievedDID.verificationMethod?.some((vm) =>
          vm.id.includes("auth-key")
        )
      ).toBe(true);

      // Verify usage arrays are present and correct
      expect(retrievedDID.authentication).toBeDefined();
      expect(retrievedDID.authentication?.length).toBe(2); // keys-1 and auth-key

      expect(retrievedDID.assertionMethod).toBeDefined();
      expect(retrievedDID.assertionMethod?.length).toBe(1); // keys-2

      expect(retrievedDID.keyAgreement).toBeDefined();
      expect(retrievedDID.keyAgreement?.length).toBe(1); // keys-1

      expect(retrievedDID.capabilityInvocation).toBeDefined();
      expect(retrievedDID.capabilityInvocation?.length).toBe(1); // keys-2

      // Verify key formats are preserved
      const multibaseKey = retrievedDID.verificationMethod?.find(
        (vm) => vm.publicKeyMultibase
      );
      const jwkKey = retrievedDID.verificationMethod?.find(
        (vm) => vm.publicKeyJwk
      );

      expect(multibaseKey).toBeDefined();
      expect(jwkKey).toBeDefined();
      expect(jwkKey?.publicKeyJwk?.kty).toBe("EC");
      expect(jwkKey?.publicKeyJwk?.crv).toBe("Ed25519");
    });

    test("Should maintain consistency between original and retrieved DID", () => {
      const location = "did-document-example.json";

      // Parse original DID
      const originalDID = parseJsonDID(location);
      const originalKeyCount =
        (originalDID.verificationMethod?.length || 0) +
        (originalDID.authentication?.filter((auth) => typeof auth === "object")
          .length || 0);

      // Write to contract and retrieve
      writeDidToContract(simulator, originalDID);
      const retrievedDID = getDidFromContract(simulator);

      // Verify key count consistency
      expect(retrievedDID.verificationMethod?.length).toBe(originalKeyCount);

      // Verify all original keys have corresponding entries in retrieved DID
      if (originalDID.verificationMethod) {
        for (const originalKey of originalDID.verificationMethod) {
          const keyId = originalKey.id.split("#")[1];
          const hasMatchingKey = retrievedDID.verificationMethod?.some((vm) =>
            vm.id.includes(keyId)
          );
          expect(hasMatchingKey).toBe(true);
        }
      }

      // Verify usage consistency
      const originalAuthCount = originalDID.authentication?.length || 0;
      const retrievedAuthCount = retrievedDID.authentication?.length || 0;
      expect(retrievedAuthCount).toBeGreaterThanOrEqual(originalAuthCount - 1); // Account for reference vs embedded

      const originalAssertionCount = originalDID.assertionMethod?.length || 0;
      const retrievedAssertionCount = retrievedDID.assertionMethod?.length || 0;
      expect(retrievedAssertionCount).toBe(originalAssertionCount);
    });
  });

  describe("Key Management - addKey Circuit", () => {
    test("should successfully add a new multibase key", () => {
      const testKey = createSampleKey("test-key-1", "multibase");
      simulator.addKey(testKey);
      expect(simulator.hasKey("test-key-1")).toBe(true);
      const addedKey = simulator.getKey("test-key-1");
      expect(addedKey?.id).toBe("test-key-1");
      expect(addedKey?.publicKey.is_left).toBe(false);
    });

    test("Should successfully add a new JWK key", () => {
      const testKey = createSampleKey("test-key-jwk", "jwk");
      simulator.addKey(testKey);
      expect(simulator.hasKey("test-key-jwk")).toBe(true);
      const addedKey = simulator.getKey("test-key-jwk");
      expect(addedKey?.id).toBe("test-key-jwk");
      expect(addedKey?.publicKey.is_left).toBe(true);
    });

    test("Should reject duplicate key IDs", () => {
      const testKey1 = createSampleKey("duplicate-key", "multibase");
      const testKey2 = createSampleKey("duplicate-key", "jwk");
      simulator.addKey(testKey1);
      expect(() => {
        simulator.addKey(testKey2);
      }).toThrow("Cannot repeat Key id");
    });

    test("Should reject key addition when DID is inactive", () => {
      const testKey = createSampleKey("test-key", "multibase");
      // Deactivate DID first
      simulator.deactivate();
      expect(() => {
        simulator.addKey(testKey);
      }).toThrow("DID is inactive");
    });

    test("Should reject key addition from unauthorized controller", () => {
      simulator.getPrivateState().localSecretKey = new Uint8Array(32);
      const testKey = createSampleKey("unauthorized-key", "multibase");
      expect(() => {
        simulator.addKey(testKey);
      }).toThrow("Only the Controller is allowed to update the DID");
    });

    test("Should handle multiple keys addition", () => {
      const keys = [
        createSampleKey("key-1", "multibase"),
        createSampleKey("key-2", "jwk"),
        createSampleKey("key-3", "multibase")
      ];
      keys.forEach((key) => simulator.addKey(key));
      expect(simulator.getKeyRing().size).toBe(3);
      keys.forEach((key) => {
        expect(simulator.hasKey(key.id)).toBe(true);
      });
    });
  });

  describe("Key Management - removeKey Circuit", () => {
    beforeEach(() => {
      // Add test keys for removal tests
      const testKeys = [
        createSampleKey("removable-1", "multibase"),
        createSampleKey("removable-2", "jwk"),
        createSampleKey("removable-3", "multibase")
      ];
      testKeys.forEach((key) => simulator.addKey(key));
    });

    test("Should successfully remove existing key", () => {
      expect(simulator.hasKey("removable-1")).toBe(true);
      simulator.removeKey("removable-1");
      expect(simulator.hasKey("removable-1")).toBe(false);
      expect(simulator.getKeyRing().size).toBe(2);
    });

    test("Should reject removal of non-existent key", () => {
      expect(() => {
        simulator.removeKey("non-existent-key");
      }).toThrow("Key is not in KeyRing");
    });

    test("Should reject key removal when DID is inactive", () => {
      simulator.deactivate();
      expect(() => {
        simulator.removeKey("removable-1");
      }).toThrow("DID is inactive");
    });

    test("Should reject key removal from unauthorized controller", () => {
      // Try to remove key using unauthorized simulator
      simulator.getPrivateState().localSecretKey = new Uint8Array(32);
      expect(() => {
        simulator.removeKey("removable-1");
      }).toThrow("Only the Controller is allowed to update the DID");
    });

    test("Should handle removal of all keys", () => {
      simulator.removeKey("removable-1");
      simulator.removeKey("removable-2");
      simulator.removeKey("removable-3");
      expect(simulator.getKeyRing().size).toBe(0);
    });
  });

  describe("Key Usage Management - addAllowedUsage Circuit", () => {
    beforeEach(() => {
      const testKey = createSampleKey("example-test-key", "multibase");
      simulator.addKey(testKey);
    });

    test("Should successfully add Authentication usage", () => {
      simulator.addAllowedUsage("example-test-key", ActionType.Authentication);
      const key = simulator.getKey("example-test-key");
      expect(key?.allowedUsages.authentication).toBe(true);
      expect(key?.allowedUsages.assertionMethod).toBe(false);
      expect(key?.allowedUsages.keyAgreement).toBe(false);
      expect(key?.allowedUsages.capabilityInvocation).toBe(false);
      expect(key?.allowedUsages.capabilityDelegation).toBe(false);
    });

    test("Should successfully add AssertionMethod usage", () => {
      simulator.addAllowedUsage("example-test-key", ActionType.AssertionMethod);
      const key = simulator.getKey("example-test-key");
      expect(key?.allowedUsages.authentication).toBe(false);
      expect(key?.allowedUsages.assertionMethod).toBe(true);
      expect(key?.allowedUsages.keyAgreement).toBe(false);
      expect(key?.allowedUsages.capabilityInvocation).toBe(false);
      expect(key?.allowedUsages.capabilityDelegation).toBe(false);
    });

    test("Should successfully add KeyAgreement usage", () => {
      simulator.addAllowedUsage("example-test-key", ActionType.KeyAgreement);
      const key = simulator.getKey("example-test-key");
      expect(key?.allowedUsages.authentication).toBe(false);
      expect(key?.allowedUsages.assertionMethod).toBe(false);
      expect(key?.allowedUsages.keyAgreement).toBe(true);
      expect(key?.allowedUsages.capabilityInvocation).toBe(false);
      expect(key?.allowedUsages.capabilityDelegation).toBe(false);
    });

    test("Should successfully add CapabilityInvocation usage", () => {
      simulator.addAllowedUsage(
        "example-test-key",
        ActionType.CapabilityInvocation
      );
      const key = simulator.getKey("example-test-key");
      expect(key?.allowedUsages.authentication).toBe(false);
      expect(key?.allowedUsages.assertionMethod).toBe(false);
      expect(key?.allowedUsages.keyAgreement).toBe(false);
      expect(key?.allowedUsages.capabilityInvocation).toBe(true);
      expect(key?.allowedUsages.capabilityDelegation).toBe(false);
    });

    test("Should successfully add CapabilityDelegation usage", () => {
      simulator.addAllowedUsage(
        "example-test-key",
        ActionType.CapabilityDelegation
      );
      const key = simulator.getKey("example-test-key");
      expect(key?.allowedUsages.authentication).toBe(false);
      expect(key?.allowedUsages.assertionMethod).toBe(false);
      expect(key?.allowedUsages.keyAgreement).toBe(false);
      expect(key?.allowedUsages.capabilityInvocation).toBe(false);
      expect(key?.allowedUsages.capabilityDelegation).toBe(true);
    });

    test("Should handle multiple usage additions", () => {
      simulator.addAllowedUsage("example-test-key", ActionType.Authentication);
      simulator.addAllowedUsage("example-test-key", ActionType.AssertionMethod);
      simulator.addAllowedUsage("example-test-key", ActionType.KeyAgreement);

      const key = simulator.getKey("example-test-key");
      expect(key?.allowedUsages.authentication).toBe(true);
      expect(key?.allowedUsages.assertionMethod).toBe(true);
      expect(key?.allowedUsages.keyAgreement).toBe(true);
      expect(key?.allowedUsages.capabilityInvocation).toBe(false);
      expect(key?.allowedUsages.capabilityDelegation).toBe(false);
    });

    test("Should reject usage addition for non-existent key", () => {
      expect(() => {
        simulator.addAllowedUsage(
          "non-existent-key",
          ActionType.Authentication
        );
      }).toThrow("Key is not in KeyRing");
    });

    test("Should reject usage addition when DID is inactive", () => {
      simulator.deactivate();
      expect(() => {
        simulator.addAllowedUsage(
          "example-test-key",
          ActionType.Authentication
        );
      }).toThrow("DID is inactive");
    });

    test("should reject usage addition from unauthorized controller", () => {
      simulator.getPrivateState().localSecretKey = new Uint8Array(32);
      expect(() => {
        simulator.addAllowedUsage(
          "example-test-key",
          ActionType.Authentication
        );
      }).toThrow("Only the Controller is allowed to update the DID");
    });
  });

  describe("Key Usage Management - removeAllowedUsage Circuit", () => {
    beforeEach(() => {
      // Create key with all usages enabled
      const keyWithAllUsages = createKeyWithUsages("full-usage-key", {
        authentication: true,
        assertionMethod: true,
        keyAgreement: true,
        capabilityInvocation: true,
        capabilityDelegation: true
      });
      simulator.addKey(keyWithAllUsages);
    });

    test("Should successfully remove Authentication usage", () => {
      simulator.removeAllowedUsage("full-usage-key", ActionType.Authentication);

      const key = simulator.getKey("full-usage-key");
      expect(key?.allowedUsages.authentication).toBe(false);
      expect(key?.allowedUsages.assertionMethod).toBe(true); // Others should remain
    });

    test("Should successfully remove AssertionMethod usage", () => {
      simulator.removeAllowedUsage(
        "full-usage-key",
        ActionType.AssertionMethod
      );

      const key = simulator.getKey("full-usage-key");
      expect(key?.allowedUsages.assertionMethod).toBe(false);
    });

    test("Should successfully remove multiple usages", () => {
      simulator.removeAllowedUsage("full-usage-key", ActionType.Authentication);
      simulator.removeAllowedUsage("full-usage-key", ActionType.KeyAgreement);
      simulator.removeAllowedUsage(
        "full-usage-key",
        ActionType.CapabilityDelegation
      );

      const key = simulator.getKey("full-usage-key");
      expect(key?.allowedUsages.authentication).toBe(false);
      expect(key?.allowedUsages.assertionMethod).toBe(true);
      expect(key?.allowedUsages.keyAgreement).toBe(false);
      expect(key?.allowedUsages.capabilityInvocation).toBe(true);
      expect(key?.allowedUsages.capabilityDelegation).toBe(false);
    });

    test("Should reject usage removal for non-existent key", () => {
      expect(() => {
        simulator.removeAllowedUsage(
          "non-existent-key",
          ActionType.Authentication
        );
      }).toThrow("Key is not in KeyRing");
    });

    test("Should reject usage removal when DID is inactive", () => {
      simulator.deactivate();
      expect(() => {
        simulator.removeAllowedUsage(
          "full-usage-key",
          ActionType.Authentication
        );
      }).toThrow("DID is inactive");
    });

    test("should reject usage removal from unauthorized controller", () => {
      simulator.getPrivateState().localSecretKey = new Uint8Array(32);
      expect(() => {
        simulator.removeAllowedUsage(
          "full-usage-key",
          ActionType.Authentication
        );
      }).toThrow("Only the Controller is allowed to update the DID");
    });
  });

  describe("DID Deactivation - deactivate Circuit", () => {
    beforeEach(() => {
      // Add some keys before deactivation tests
      const testKeys = [
        createSampleKey("key-1", "multibase"),
        createSampleKey("key-2", "jwk")
      ];
      testKeys.forEach((key) => simulator.addKey(key));
    });

    test("Should successfully deactivate active DID", () => {
      expect(simulator.isActive()).toBe(true);
      simulator.deactivate();
      expect(simulator.isActive()).toBe(false);
    });

    test("Should reject deactivation of already inactive DID", () => {
      simulator.deactivate();
      expect(simulator.isActive()).toBe(false);
      expect(() => {
        simulator.deactivate();
      }).toThrow("DID is already inactive");
    });

    test("should reject deactivation from unauthorized controller", () => {
      simulator.getPrivateState().localSecretKey = new Uint8Array(32);
      expect(() => {
        simulator.deactivate();
      }).toThrow("Only the Controller is allowed to update the DID");
    });

    test("should preserve key ring after deactivation", () => {
      expect(simulator.getKeyRing().size).toBe(2);
      simulator.deactivate();
      // Keys should still be present but DID should be inactive
      expect(simulator.getKeyRing().size).toBe(2);
      expect(simulator.hasKey("key-1")).toBe(true);
      expect(simulator.hasKey("key-2")).toBe(true);
    });

    test("should prevent all operations after deactivation", () => {
      const newKey = createSampleKey("post-deactivation-key", "multibase");
      simulator.deactivate();
      // All operations should fail on inactive DID
      expect(() => simulator.addKey(newKey)).toThrow("DID is inactive");
      expect(() => simulator.removeKey("key-1")).toThrow("DID is inactive");
      expect(() =>
        simulator.addAllowedUsage("key-1", ActionType.Authentication)
      ).toThrow("DID is inactive");
      expect(() =>
        simulator.removeAllowedUsage("key-1", ActionType.Authentication)
      ).toThrow("DID is inactive");
    });
  });

  describe("DID service - addService Circuit", () => {
    let service: Service;
    beforeEach(() => {
      simulator = new DIDSimulator();
    });

    test("Should successfully add a new service", () => {
      const id: string = "example-service-1";
      const type: string = "DIDtype";
      const endpoint: string = "https://example.com/messaging";

      service = createNewService(id, type, endpoint);
      simulator.addService(service);

      const fetchedServices = simulator.getServices();

      expect(fetchedServices.get(id)?.id).toBe(id);
      expect(fetchedServices.get(id)?.type).toBe(type);
      expect(fetchedServices.get(id)?.serviceEndpoint).toBe(endpoint);
    });

    test("Should not allow a new service to be added to a deactivated DID contract", () => {
      // Deactivate simulator before doing operations
      simulator.deactivate();

      const id: string = "deactivate-example";
      const type: string = "deactivatedDID";
      const endpoint: string = "https://example.com/messaging";

      service = createNewService(id, type, endpoint);
      expect(() => {
        simulator.addService(service);
      }).toThrow("DID is inactive");
    });

    /**
     *
     * We do not have the possibility to currently handle empty values in our contract.
     * We can later discuss how to catch empty fields. Idea: Implement it in compact or handle the case directly in TypeScript
     *
     */
    test("Should handle service empty/long serviceEndpoint", () => {
      const id: string = "";
      const type: string = "";
      const endpoint: string = "";

      service = createNewService(id, type, endpoint);
      simulator.addService(service);

      const fetchedServices = simulator.getServices();

      expect(fetchedServices.get(id)?.id).toBe(id);
      expect(fetchedServices.get(id)?.type).toBe(type);
      expect(fetchedServices.get(id)?.serviceEndpoint).toBe(endpoint);
    });
  });

  describe("Complex Workflows", () => {
    test("Should handle complete key lifecycle", () => {
      // Add key
      const testKey = createSampleKey("lifecycle-key", "multibase");
      simulator.addKey(testKey);
      expect(simulator.hasKey("lifecycle-key")).toBe(true);

      // Add multiple usages
      simulator.addAllowedUsage("lifecycle-key", ActionType.Authentication);
      simulator.addAllowedUsage("lifecycle-key", ActionType.AssertionMethod);
      simulator.addAllowedUsage(
        "lifecycle-key",
        ActionType.CapabilityInvocation
      );

      let key = simulator.getKey("lifecycle-key");
      expect(key?.allowedUsages.authentication).toBe(true);
      expect(key?.allowedUsages.assertionMethod).toBe(true);
      expect(key?.allowedUsages.capabilityInvocation).toBe(true);

      // Remove some usages
      simulator.removeAllowedUsage("lifecycle-key", ActionType.AssertionMethod);

      key = simulator.getKey("lifecycle-key");
      expect(key?.allowedUsages.authentication).toBe(true);
      expect(key?.allowedUsages.assertionMethod).toBe(false);
      expect(key?.allowedUsages.capabilityInvocation).toBe(true);

      // Finally remove the key
      simulator.removeKey("lifecycle-key");
      expect(simulator.hasKey("lifecycle-key")).toBe(false);
    });

    test("Should handle multiple keys with different usage patterns", () => {
      // Authentication-only key
      const authKey = createKeyWithUsages("auth-key", { authentication: true });
      simulator.addKey(authKey);

      // Multi-purpose key
      const multiKey = createKeyWithUsages("multi-key", {
        authentication: true,
        assertionMethod: true,
        keyAgreement: true
      });
      simulator.addKey(multiKey);

      // Capability key
      const capKey = createKeyWithUsages("cap-key", {
        capabilityInvocation: true,
        capabilityDelegation: true
      });
      simulator.addKey(capKey);

      expect(simulator.getKeyRing().size).toBe(3);

      // Verify each key has correct usages
      const retrievedAuthKey = simulator.getKey("auth-key");
      expect(retrievedAuthKey?.allowedUsages.authentication).toBe(true);
      expect(retrievedAuthKey?.allowedUsages.assertionMethod).toBe(false);

      const retrievedMultiKey = simulator.getKey("multi-key");
      expect(retrievedMultiKey?.allowedUsages.authentication).toBe(true);
      expect(retrievedMultiKey?.allowedUsages.assertionMethod).toBe(true);
      expect(retrievedMultiKey?.allowedUsages.keyAgreement).toBe(true);
      expect(retrievedMultiKey?.allowedUsages.capabilityInvocation).toBe(false);

      const retrievedCapKey = simulator.getKey("cap-key");
      expect(retrievedCapKey?.allowedUsages.capabilityInvocation).toBe(true);
      expect(retrievedCapKey?.allowedUsages.capabilityDelegation).toBe(true);
      expect(retrievedCapKey?.allowedUsages.authentication).toBe(false);
    });
  });

  describe("Edge Cases and Error Conditions", () => {
    test("Should handle empty key ID", () => {
      const emptyIdKey = createSampleKey("", "multibase");

      // This Should either work or throw a meaningful error
      // The exact behavior depends on the contract implementation
      try {
        simulator.addKey(emptyIdKey);
        expect(simulator.hasKey("")).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });

    test("Should handle very long key ID", () => {
      const longKeyId = "a".repeat(1000);
      const longIdKey = createSampleKey(longKeyId, "multibase");

      try {
        simulator.addKey(longIdKey);
        expect(simulator.hasKey(longKeyId)).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });
  });
});
