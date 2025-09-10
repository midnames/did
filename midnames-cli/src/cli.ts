import { type Resource } from "@midnight-ntwrk/wallet";
import { type Wallet } from "@midnight-ntwrk/wallet-api";
import { stdin as input, stdout as output } from "node:process";
import { createInterface, type Interface } from "node:readline/promises";
import { type Logger } from "pino";
import {
  type StartedDockerComposeEnvironment,
  type DockerComposeEnvironment,
} from "testcontainers";
import {
  type MidnamesProviders,
  type DeployedMidnamesContract,
} from "./common-types";
import { type Config, StandaloneConfig } from "./config";
import * as api from "./api";
import { createMidnamesSecretState } from "@midnight-ntwrk/midnight-did-contract";
import { v7 as uuidv7 } from "uuid";
import * as fs from "node:fs";
import { type DidJsonDocument } from "./types";

let logger: Logger;

/**
 * This seed gives access to tokens minted in the genesis block of a local development node - only
 * used in standalone networks to build a wallet with initial funds.
 */
const GENESIS_MINT_WALLET_SEED =
  "0000000000000000000000000000000000000000000000000000000000000001";

const CREATE_UPDATE_OR_VIEW = `
You can do one of the following:
  1. Create Midnames DID contract
  2. Update existing Midnames DID contract
  3. View existing Midnames DID contract
  4. Exit
Which would you like to do? `;

const SELECT_DID_OPERATION = `
Choose a DID operation:
  1. View DID details
  2. Add verification key
  3. Remove verification key
  4. Add key allowed usage
  5. Remove key allowed usage
  6. Deactivate DID
  7. Back to main menu
Select an option: `;

// const MAIN_LOOP_QUESTION = `
// DID Operations Menu:
//   1. Populate a new DID (interactive)
//   2. Populate DID from JSON file
//   3. View contract info
//   4. Lookup DID by ID
//   5. Perform operations on specified DID
//   6. Exit
// Choose an option: `;

const buildWallet = async (
  config: Config,
  rli: Interface
): Promise<(Wallet & Resource) | null> => {
  if (config instanceof StandaloneConfig) {
    return await api.buildWalletAndWaitForFunds(
      config,
      GENESIS_MINT_WALLET_SEED,
      ""
    );
  }
  while (true) {
    const choice = await rli.question(`
You can do one of the following:
  1. Build a fresh wallet
  2. Build wallet from a seed
  3. Exit
Which would you like to do? `);
    switch (choice) {
      case "1":
        return await api.buildFreshWallet(config);
      case "2":
        return await buildWalletFromSeed(config, rli);
      case "3":
        logger.info("Exiting...");
        return null;
      default:
        logger.error(`Invalid choice: ${choice}`);
    }
  }
};

const buildWalletFromSeed = async (
  config: Config,
  rli: Interface
): Promise<Wallet & Resource> => {
  const seed = await rli.question("Enter your wallet seed: ");
  return await api.buildWalletAndWaitForFunds(config, seed, "");
};


async function createDidContract(
  providers: MidnamesProviders
): Promise<DeployedMidnamesContract> {
  logger.info("Deploying new Midnames DID contract...");

  const localSecretKey = api.randomBytes(32);
  const privateState = createMidnamesSecretState(localSecretKey, []);
  const contract = await api.deploy(providers, privateState);

  // Display contract information
  const info = await api.displayContractInfo(providers, contract);
  logger.info("Contract deployed successfully!");
  logger.info(`Contract Address: ${info.contractAddress}`);
  logger.info(`Block Height: ${contract.deployTxData.public.blockHeight}`);
  logger.info(`Transaction ID: ${contract.deployTxData.public.txId}`);

  return contract;
};

async function updateDidContract(
  providers: MidnamesProviders,
  rli: Interface
): Promise<DeployedMidnamesContract> {
  const contractAddress = await rli.question(
    "What is the contract address (in hex)? "
  );  
  const contract = await api.joinContract(providers, contractAddress);
  
  while (true) {
    const choice = await rli.question(SELECT_DID_OPERATION);
    
    switch (choice) {
      case "1":
        await handleViewDidDetails(providers, contract, await getDidId(rli));
        break;
      case "2":
        await handleAddVerificationKey(providers, contract, rli, await getDidId(rli));
        break;
      case "3":
        await handleRemoveVerificationKey(providers, contract, rli, await getDidId(rli));
        break;
      case "4":
        await handleAddKeyAllowedUsage(providers, contract, rli, await getDidId(rli));
        break;
      case "5":
        await handleRemoveKeyAllowedUsage(providers, contract, rli, await getDidId(rli));
        break;
      case "6":
        await handleDeactivateDid(contract, rli, await getDidId(rli));
        break;
      case "7":
        logger.info("Returning to main menu...");
        return contract;
      default:
        logger.error(`Invalid choice: ${choice}`);
    }
  }
};

async function viewDidContract(
  providers: MidnamesProviders,
  rli: Interface
): Promise<DeployedMidnamesContract> {
  const contractAddress = await rli.question(
    "What is the contract address (in hex)? "
  );
  
  const contract = await api.joinContract(providers, contractAddress);
  await handleViewContractInfo(providers, contract);
  
  return contract;
};

async function getDidId(rli: Interface): Promise<string> {
  const didId = await rli.question("Enter the DID ID (e.g., did:midnight:example): ");
  if (!didId.trim()) {
    throw new Error("DID identifier cannot be empty");
  }
  return didId.trim();
};

async function mainLoop(
  providers: MidnamesProviders,
  rli: Interface
): Promise<DeployedMidnamesContract | null> {
  while (true) {
    const choice = await rli.question(CREATE_UPDATE_OR_VIEW);
    switch (choice) {
      case "1":
        const new_did_contract_address = await createDidContract(providers);
        await handleCreateDidInteractive(providers, new_did_contract_address, rli);
      case "2":
        return await updateDidContract(providers, rli);
      case "3":
        return await viewDidContract(providers, rli);
      case "4":
        logger.info("Exiting...");
        return null;
      default:
        logger.error(`Invalid choice: ${choice}`);
    }
  }
};

const mapContainerPort = (
  env: StartedDockerComposeEnvironment,
  url: string,
  containerName: string
) => {
  const mappedUrl = new URL(url);
  const container = env.getContainer(containerName);

  mappedUrl.port = String(container.getFirstMappedPort());

  return mappedUrl.toString().replace(/\/+$/, "");
};

export const run = async (
  config: Config,
  _logger: Logger,
  dockerEnv?: DockerComposeEnvironment
): Promise<void> => {
  logger = _logger;
  api.setLogger(_logger);
  const rli = createInterface({ input, output, terminal: true });
  let env;
  if (dockerEnv !== undefined) {
    env = await dockerEnv.up();

    if (config instanceof StandaloneConfig) {
      config.indexer = mapContainerPort(
        env,
        config.indexer,
        "midnames-indexer"
      );
      config.indexerWS = mapContainerPort(
        env,
        config.indexerWS,
        "midnames-indexer"
      );
      config.node = mapContainerPort(env, config.node, "midnames-node");
      config.proofServer = mapContainerPort(
        env,
        config.proofServer,
        "midnames-proof-server"
      );
    }
  }
  const wallet = await buildWallet(config, rli);
  try {
    if (wallet !== null) {
      const providers = await api.configureProviders(wallet, config);
      await mainLoop(providers, rli); // Change it to main(providers, rli)? charlar
    }
  } catch (e) {
    if (e instanceof Error) {
      logger.error(`Found error '${e.message}'`);
      logger.info("Exiting...");
      logger.debug(`${e.stack}`);
    } else {
      throw e;
    }
  } finally {
    try {
      rli.close();
      rli.removeAllListeners();
    } catch (e) {
      logger.error(`Error closing readline interface: ${e}`);
    } finally {
      try {
        if (wallet !== null) {
          await wallet.close();
        }
      } catch (e) {
        logger.error(`Error closing wallet: ${e}`);
      } finally {
        try {
          if (env !== undefined) {
            await env.down();
            logger.info("Goodbye");
          }
        } catch (e) {
          logger.error(`Error shutting down docker environment: ${e}`);
        }
      }
    }
  }
};

const handleCreateDidInteractive = async (
  providers: MidnamesProviders,
  contract: DeployedMidnamesContract,
  rli: Interface
): Promise<void> => {
  try {
    await createDidWithManualInput(providers, contract, rli);
  } catch (error) {
    logger.error(`Failed to create DID: ${error}`);
  }
};

const createDidWithManualInput = async (
  providers: MidnamesProviders,
  contract: DeployedMidnamesContract,
  rli: Interface
): Promise<void> => {
  logger.info("\n=== DID Creation ===");

  const didId = `did:midnight:${uuidv7()}`;
  logger.info(`Generated DID ID: ${didId}`);

  logger.info("\n--- (single) Private Key (local_secret_key) ---");
  const privateKeyInput = await rli.question(
    "Enter (single) private key (32 bytes as 64-character hex string, press Enter to auto-generate): "
  );

  let privateKey: Uint8Array;
  if (privateKeyInput.trim()) {
    // Validate hex input - should be exactly 32 bytes (64 hex characters)
    const hexRegex = /^[0-9a-fA-F]{64}$/;
    if (!hexRegex.test(privateKeyInput.trim())) {
      logger.error(
        "Invalid private key format. Must be exactly 32 bytes as 64-character hex string (e.g., a1b2c3d4...)."
      );
      return;
    }
    privateKey = new Uint8Array(Buffer.from(privateKeyInput.trim(), "hex"));
    logger.info("Using provided (single) private key (32 bytes)");
  } else {
    privateKey = api.randomBytes(32);
    logger.info(
      `Auto-generated (single) private key (32 bytes): ${Buffer.from(privateKey).toString("hex")}`
    );
  }

  // Multiple Local Secret Keys for Witness (multiple_local_secret_keys)
  logger.info(
    "\n--- Multiple Local Secret Keys (multiple_local_secret_keys) ---"
  );
  const multipleKeysInput = await rli.question(
    "Enter additional secret keys (comma-separated, 32 bytes each as 64-character hex, max 5 keys, press Enter to skip): "
  );

  let multipleKeys: Uint8Array[] = [];
  if (multipleKeysInput.trim()) {
    const keyStrings = multipleKeysInput
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k);
    if (keyStrings.length > 5) {
      logger.error("Maximum 5 additional keys allowed.");
      return;
    }

    const hexRegex = /^[0-9a-fA-F]{64}$/;
    for (const keyStr of keyStrings) {
      if (!hexRegex.test(keyStr)) {
        logger.error(
          `Invalid key format: ${keyStr}. Must be exactly 32 bytes as 64-character hex string.`
        );
        return;
      }
      multipleKeys.push(new Uint8Array(Buffer.from(keyStr, "hex")));
    }
    logger.info(`Using ${multipleKeys.length} additional secret keys`);
  } else {
    logger.info("No additional secret keys provided");
  }

  const contextInput = await rli.question(
    "Additional context URIs (comma-separated, press Enter for default): "
  );
  const contexts = contextInput.trim()
    ? [
        "https://www.w3.org/ns/did/v1",
        ...contextInput.split(",").map((c) => c.trim()),
      ]
    : ["https://www.w3.org/ns/did/v1"];

  logger.info("\n--- Verification Method ---");
  const vmId =
    (await rli.question(
      "Verification Method ID (press Enter for default): "
    )) || "keys-1";
  const vmType =
    (await rli.question(
      "Verification Method type (press Enter for BIP32-Ed25519): "
    )) || "BIP32-Ed25519";
  const vmController =
    (await rli.question(`Controller (press Enter for self-sovereign): `)) ||
    didId;

  const keyTypeChoice = await rli.question(
    "Key type: 1) Public Key Hex, 2) ADA Address (default: 1): "
  );
  let publicKeyHex = "";
  let adaAddress = "";

  if (keyTypeChoice.trim() === "2") {
    adaAddress = await rli.question("ADA Address: ");
  } else {
    publicKeyHex =
      (await rli.question(
        "Public Key Hex (press Enter for auto-generated): "
      )) || "0x" + "a".repeat(128);
  }

  logger.info("\n--- Authentication Method ---");
  const authChoice = await rli.question(
    "Authentication method: 1) Reference to verification method, 2) Embedded method (default: 1): "
  );

  logger.info("\n--- Service ---");
  const serviceId =
    (await rli.question("Service ID (press Enter for default): ")) ||
    "service-1";
  const serviceType =
    (await rli.question("Service type (press Enter for DIDCommMessaging): ")) ||
    "DIDCommMessaging";
  const serviceEndpoint =
    (await rli.question("Service endpoint (press Enter for default): ")) ||
    "https://example.com/endpoint";

  logger.info("\n--- Credentials ---");
  const credentialData =
    (await rli.question("Credential data (press Enter for default): ")) ||
    "credential-data";
  const credentialKey =
    (await rli.question(
      "Credential public key multibase (press Enter for default): "
    )) || "z6MkHaXU2BzXhf8X4n6Q1Q2QJ9CkN5j8L9M2P3R4S5T6U7V8W9X";

  // Create the DID document structure
  const didDocument: DidJsonDocument = {
    id: didId,
    context: contexts,
    verificationMethod: [
      {
        id: vmId,
        type: vmType,
        controller: vmController,
        ...(publicKeyHex && { publicKeyHex }),
        ...(adaAddress && { AdaAddress: adaAddress }),
      },
    ],
    authentication:
      authChoice.trim() === "2"
        ? [
            {
              id: `${didId}#auth-1`,
              type: vmType,
              controller: vmController,
              publicKeyMultibase:
                "z6MkHaXU2BzXhf8X4n6Q1Q2QJ9CkN5j8L9M2P3R4S5T6U7V8W9X",
            },
          ]
        : [vmId],
    service: [
      {
        id: serviceId,
        type: serviceType,
        serviceEndpoint: serviceEndpoint,
      },
    ],
    credentials: [
      {
        data: credentialData,
        publicKeyMultibase: credentialKey,
      },
    ],
  };

  logger.info("\n=== DID Document Summary ===");
  logger.info(JSON.stringify(didDocument, null, 2));

  const confirmChoice = await rli.question(
    "\nCreate DID with these values? (y/n): "
  );
  if (
    confirmChoice.toLowerCase() !== "y" &&
    confirmChoice.toLowerCase() !== "yes"
  ) {
    logger.info("DID creation cancelled.");
    return;
  }

  logger.info("Creating DID... This may take a moment to generate the proof.");
  const result = await api.createDidFromDocument(
    contract,
    didDocument,
    providers,
    privateKey,
    multipleKeys
  );

  logger.info(`\n=== DID Creation Result ===`);
  logger.info(`DID ID: ${result.didId}`);
  logger.info(`Transaction ID: ${result.txId}`);
};

const handleCreateDidFromFile = async (
  providers: MidnamesProviders,
  contract: DeployedMidnamesContract,
  rli: Interface
): Promise<void> => {
  try {
    const filePath = await rli.question(
      `Enter the path to your .did.json file (press Enter for example): `
    );
    let actualPath = filePath.trim();

    let fileContent: string;

    if (!actualPath) {
      fileContent = `
      {
      "context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/suites/ed25519-2020/v1"],
      "id": "did:midnight:d36d6f76-e463-4e48-a97e-908edaee6453",
      "updated": "2019-06-30T12:00:00Z",
      "authentication": [
        "did:midnight:d36d6f76-e463-4e48-a97e-908edaee6453#keys-1",
        {
        "id": "did:midnight:d36d6f76-e463-4e48-a97e-908edaee6453#keys-2",
        "type": "BIP32-Ed25519",
        "controller": [
          "did:midnight:5Ee76017be7F983a520a778B413758A9DB49cBe9",
          "did:midnight:9861eE37Ede3dCab070DF227155D86A7438d8Ed2"
        ],
        "publicKeyHex": "0x03a835599850544b4c0a222d594be5d59cf298f5a3fd90bff1c8caa064523745f3"
        }
      ],
      "verificationMethod": [
        {
        "id": "did:midnight:d36d6f76-e463-4e48-a97e-908edaee6453#keys-1",
        "type": "BIP32-Ed25519",
        "controller": "did:midnight:d36d6f76-e463-4e48-a97e-908edaee6453",
        "publicKeyHex": "0xfbf38de9fb40edcdab412094d24fa39a314f3d3f52f5860e2509c32522eda30161fe70dfc9f90434d64bd976ede4f112d4f2d8e34d28fe48281663219d2ddac6"
        },
        {
        "id": "did:midnight:d36d6f76-e463-4e48-a97e-908edaee6453#keys-1",
        "type": "BIP32-Ed25519",
        "controller": "did:midnight:d36d6f76-e463-4e48-a97e-908edaee6453",
        "AdaAddress": "addr1qxjq9aj8hy29jkp9dxeepe88ksayl4kqw7qe8et33j6ucxmj2ldj3f0f2l3xrk8ep7hwvde3wa8l9w4wkp8wxfshta2sya6pxt"
        }
      ],
      "service": [
        {
        "id": "did:midnight:d36d6f76-e463-4e48-a97e-908edaee6453#some-service",
        "type": "SomeServiceType",
        "serviceEndpoint": "Some URL"
        }
      ],
      "credentials": [
        {
        "data": "debc879591e984d2f7521a414d1264a79135ea62fe97ad7abfffbaa2efd485ca",
        "publicKeyMultibase": "-----BEGIN RSA PUBLIC KEY-----\\nMIIBCgKCAQEAs7Z/wvbS0Cg2AkdPJJ/cd8inoNUNJAZAIUlJPosyVruwMHLT707+\\n6VTzV4qSQRMVQ1IJe22hQGLYqGvdN6TrXU5X3DsyyJxkBgHd35tOTSrUZDKOS7gX\\n+yfj6YqRZvi+2Xfegj5kJX2hT/EOfYWO1KbFpjM+zovOQ9Um/ljwWsj9019Wv76m\\nWhlpepKnR7k8tjHLdlM6iksbQltEpq79r2HEYj9hRKCoV5d1uWYd7906K1asN0zh\\n8XroQESwu8Tp/kIhvXyP4WjxOJj2lh5ZpjtrJ3Qbk9ZPF7KNcAmEgqBo6fDz1Z9Q\\ndlp6HTc2xuKPN1h913i5GdamCHpHphucMwIDAQAB\\n-----END RSA PUBLIC KEY-----\\n"
        }
      ]
      }
      `;
      actualPath = "[example]";
    } else {
      if (!fs.existsSync(actualPath)) {
        logger.error(`File not found: ${actualPath}`);
        return;
      }
      fileContent = fs.readFileSync(actualPath, "utf-8");
    }
    const didDocument = JSON.parse(fileContent) as DidJsonDocument;

    logger.info(`Loaded DID document from: ${actualPath}`);
    logger.info("\n=== DID Document Summary ===");
    logger.info(`DID ID: ${didDocument.id}`);
    logger.info(`@Contexts: ${didDocument.context?.length || 0}`);
    logger.info(
      `Verification Methods: ${didDocument.verificationMethod?.length || 0}`
    );
    logger.info(
      `Authentication Methods: ${didDocument.authentication?.length || 0}`
    );
    logger.info(`Services: ${didDocument.service?.length || 0}`);
    logger.info(`Credentials: ${didDocument.credentials?.length || 0}`);

    const choice = await rli.question("\nCreate DID from this file? (y/n): ");
    if (choice.toLowerCase() !== "y" && choice.toLowerCase() !== "yes") {
      logger.info("DID creation cancelled.");
      return;
    }

    // (single) Private Key for Witness (local_secret_key)
    logger.info("\n--- (single) Private Key (local_secret_key) ---");
    const privateKeyInput = await rli.question(
      "Enter (single) private key (32 bytes as 64-character hex string, press Enter to auto-generate): "
    );

    let privateKey: Uint8Array;
    if (privateKeyInput.trim()) {
      // Validate hex input - should be exactly 32 bytes (64 hex characters)
      const hexRegex = /^[0-9a-fA-F]{64}$/;
      if (!hexRegex.test(privateKeyInput.trim())) {
        logger.error(
          "Invalid private key format. Must be exactly 32 bytes as 64-character hex string (e.g., a1b2c3d4...)."
        );
        return;
      }
      privateKey = new Uint8Array(Buffer.from(privateKeyInput.trim(), "hex"));
      logger.info("Using provided (single) private key (32 bytes)");
    } else {
      privateKey = api.randomBytes(32);
      logger.info(
        `Auto-generated (single) private key (32 bytes): ${Buffer.from(privateKey).toString("hex")}`
      );
    }

    // Multiple Local Secret Keys for Witness (multiple_local_secret_keys)
    logger.info(
      "\n--- Multiple Local Secret Keys (multiple_local_secret_keys) ---"
    );
    const multipleKeysInput = await rli.question(
      "Enter additional secret keys (comma-separated, 32 bytes each as 64-character hex, max 5 keys, press Enter to skip): "
    );

    let multipleKeys: Uint8Array[] = [];
    if (multipleKeysInput.trim()) {
      const keyStrings = multipleKeysInput
        .split(",")
        .map((k) => k.trim())
        .filter((k) => k);
      if (keyStrings.length > 5) {
        logger.error("Maximum 5 additional keys allowed.");
        return;
      }

      const hexRegex = /^[0-9a-fA-F]{64}$/;
      for (const keyStr of keyStrings) {
        if (!hexRegex.test(keyStr)) {
          logger.error(
            `Invalid key format: ${keyStr}. Must be exactly 32 bytes as 64-character hex string.`
          );
          return;
        }
        multipleKeys.push(new Uint8Array(Buffer.from(keyStr, "hex")));
      }
      logger.info(`Using ${multipleKeys.length} additional secret keys`);
    } else {
      logger.info("No additional secret keys provided");
    }

    logger.info(
      "Creating DID... This may take a moment to generate the proof."
    );
    const result = await api.createDidFromDocument(
      contract,
      didDocument,
      providers,
      privateKey,
      multipleKeys
    );

    logger.info(`\n=== DID Creation Result ===`);
    logger.info(`DID ID: ${result.didId}`);
    logger.info(`Transaction ID: ${result.txId}`);
  } catch (error) {
    logger.error(`Failed to create DID from file: ${error}`);
  }
};


const handleViewContractInfo = async (
  providers: MidnamesProviders,
  contract: DeployedMidnamesContract
): Promise<void> => {
  try {
    const info = await api.displayContractInfo(providers, contract);
    logger.info(`\n=== Contract Information ===`);
    logger.info(`Contract Address: ${info.contractAddress}`);
    logger.info(`Controller Public Key: ${info.publicKey}$`)
    logger.info(`Active DID: ${info.active}`);
  } catch (error) {
    logger.error(`Failed to get contract info: ${error}`);
  }
};

const handleViewDidDetails = async (
  providers: MidnamesProviders,
  contract: DeployedMidnamesContract,
  didId: string
): Promise<void> => {
  try {
    const contractAddress = contract.deployTxData.public.contractAddress;
    const formattedDidData = await api.getDidFormatted(
      providers,
      contractAddress,
      didId
    );
    
    if (formattedDidData) {
      logger.info(`\n=== DID Details ===`);
      logger.info(JSON.stringify(formattedDidData, null, 2));
    } else {
      logger.info("DID not found or error occurred.");
    }
  } catch (error) {
    logger.error(`Failed to view DID details: ${error}`);
  }
};

const handleAddVerificationKey = async (
  providers: MidnamesProviders,
  contract: DeployedMidnamesContract,
  rli: Interface,
  didId: string
): Promise<void> => {
  try {
    logger.info("\n--- Add Verification Key ---");
    
    const keyId = await rli.question("Key ID (e.g., 'keys-2'): ");
    if (!keyId.trim()) {
      logger.error("Key ID cannot be empty");
      return;
    }
    
    const keyType = await rli.question("Key type (press Enter for 'BIP32-Ed25519'): ") || "BIP32-Ed25519";
    
    const keyChoice = await rli.question(
      "Key data type: 1) Public Key Hex, 2) ADA Address (default: 1): "
    );
    
    let publicKeyHex = "";
    let adaAddress = "";
    
    if (keyChoice.trim() === "2") {
      adaAddress = await rli.question("ADA Address: ");
      if (!adaAddress.trim()) {
        logger.error("ADA Address cannot be empty");
        return;
      }
    } else {
      publicKeyHex = await rli.question("Public Key Hex (with 0x prefix): ");
      if (!publicKeyHex.trim()) {
        logger.error("Public Key Hex cannot be empty");
        return;
      }
    }
    
    const controller = await rli.question(`Controller (press Enter for self-controlled): `) || didId;
    
    logger.info("Setting up key allowed usages...");
    const authentication = (await rli.question("Allow Authentication? (y/n): ")).toLowerCase() === "y";
    const assertionMethod = (await rli.question("Allow Assertion Method? (y/n): ")).toLowerCase() === "y";
    const keyAgreement = (await rli.question("Allow Key Agreement? (y/n): ")).toLowerCase() === "y";
    const capabilityInvocation = (await rli.question("Allow Capability Invocation? (y/n): ")).toLowerCase() === "y";
    const capabilityDelegation = (await rli.question("Allow Capability Delegation? (y/n): ")).toLowerCase() === "y";
    
    const confirm = await rli.question(`\nAdd key '${keyId.trim()}' to DID? (y/n): `);
    if (confirm.toLowerCase() !== "y" && confirm.toLowerCase() !== "yes") {
      logger.info("Operation cancelled.");
      return;
    }
    
    logger.info("Adding verification key...");
    await api.addVerificationKey(contract, didId, {
      id: keyId.trim(),
      type: keyType,
      controller: controller,
      publicKeyHex: publicKeyHex || undefined,
      AdaAddress: adaAddress || undefined,
    }, {
      authentication,
      assertionMethod,
      keyAgreement,
      capabilityInvocation,
      capabilityDelegation,
    });
    
    logger.info("Verification key added successfully!");
  } catch (error) {
    logger.error(`Failed to add verification key: ${error}`);
  }
};

const handleRemoveVerificationKey = async (
  providers: MidnamesProviders,
  contract: DeployedMidnamesContract,
  rli: Interface,
  didId: string
): Promise<void> => {
  try {
    logger.info("\n--- Remove Verification Key ---");
    
    const contractAddress = contract.deployTxData.public.contractAddress;
    const didData = await api.getDid(providers, contractAddress, didId);
    
    if (!didData || didData.verificationMethods.length === 0) {
      logger.info("No verification methods found for this DID.");
      return;
    }
    
    logger.info("Current verification methods:");
    didData.verificationMethods.forEach((vm: any, index: number) => {
      logger.info(`  ${index + 1}. ${vm.id} (${vm.type})`);
    });
    
    const keyId = await rli.question("Enter the Key ID to remove: ");
    if (!keyId.trim()) {
      logger.error("Key ID cannot be empty");
      return;
    }
    
    const confirm = await rli.question(`\nRemove key '${keyId.trim()}' from DID? (y/n): `);
    if (confirm.toLowerCase() !== "y" && confirm.toLowerCase() !== "yes") {
      logger.info("Operation cancelled.");
      return;
    }
    
    logger.info("Removing verification key...");
    await api.removeVerificationKey(contract, didId, keyId.trim());
    
    logger.info("Verification key removed successfully!");
  } catch (error) {
    logger.error(`Failed to remove verification key: ${error}`);
  }
};

const handleAddKeyAllowedUsage = async (
  providers: MidnamesProviders,
  contract: DeployedMidnamesContract,
  rli: Interface,
  didId: string
): Promise<void> => {
  try {
    logger.info("\n--- Add Key Allowed Usage ---");
    
    const keyId = await rli.question("Enter Key ID: ");
    if (!keyId.trim()) {
      logger.error("Key ID cannot be empty");
      return;
    }
    
    const usageChoice = await rli.question(`
Select usage to add:
  1. Authentication
  2. Assertion Method
  3. Key Agreement
  4. Capability Invocation
  5. Capability Delegation
Choose option: `);
    
    let actionType: string;
    switch (usageChoice) {
      case "1":
        actionType = "Authentication";
        break;
      case "2":
        actionType = "AssertionMethod";
        break;
      case "3":
        actionType = "KeyAgreement";
        break;
      case "4":
        actionType = "CapabilityInvocation";
        break;
      case "5":
        actionType = "CapabilityDelegation";
        break;
      default:
        logger.error("Invalid choice");
        return;
    }
    
    const confirm = await rli.question(`\nAdd '${actionType}' usage to key '${keyId.trim()}'? (y/n): `);
    if (confirm.toLowerCase() !== "y" && confirm.toLowerCase() !== "yes") {
      logger.info("Operation cancelled.");
      return;
    }
    
    logger.info("Adding key allowed usage...");
    await api.addKeyAllowedUsage(contract, didId, keyId.trim(), actionType);
    
    logger.info("Key allowed usage added successfully!");
  } catch (error) {
    logger.error(`Failed to add key allowed usage: ${error}`);
  }
};

const handleRemoveKeyAllowedUsage = async (
  providers: MidnamesProviders,
  contract: DeployedMidnamesContract,
  rli: Interface,
  didId: string
): Promise<void> => {
  try {
    logger.info("\n--- Remove Key Allowed Usage ---");
    
    const keyId = await rli.question("Enter Key ID: ");
    if (!keyId.trim()) {
      logger.error("Key ID cannot be empty");
      return;
    }
    
    const usageChoice = await rli.question(`
Select usage to remove:
  1. Authentication
  2. Assertion Method
  3. Key Agreement
  4. Capability Invocation
  5. Capability Delegation
Choose option: `);
    
    let actionType: string;
    switch (usageChoice) {
      case "1":
        actionType = "Authentication";
        break;
      case "2":
        actionType = "AssertionMethod";
        break;
      case "3":
        actionType = "KeyAgreement";
        break;
      case "4":
        actionType = "CapabilityInvocation";
        break;
      case "5":
        actionType = "CapabilityDelegation";
        break;
      default:
        logger.error("Invalid choice");
        return;
    }
    
    const confirm = await rli.question(`\nRemove '${actionType}' usage from key '${keyId.trim()}'? (y/n): `);
    if (confirm.toLowerCase() !== "y" && confirm.toLowerCase() !== "yes") {
      logger.info("Operation cancelled.");
      return;
    }
    
    logger.info("Removing key allowed usage...");
    await api.removeKeyAllowedUsage(contract, didId, keyId.trim(), actionType);
    
    logger.info("Key allowed usage removed successfully!");
  } catch (error) {
    logger.error(`Failed to remove key allowed usage: ${error}`);
  }
};

const handleDeactivateDid = async (
  contract: DeployedMidnamesContract,
  rli: Interface,
  didId: string
): Promise<void> => {
  try {
    logger.info("\n--- Deactivate DID ---");
    logger.warn("WARNING: This action will permanently deactivate the DID. This cannot be undone.");
    
    const confirm1 = await rli.question(`\nAre you sure you want to deactivate ${didId}? (yes/no): `);
    if (confirm1.toLowerCase() !== "yes") {
      logger.info("Operation cancelled.");
      return;
    }
    
    const confirm2 = await rli.question("Type 'DEACTIVATE' to confirm: ");
    if (confirm2 !== "DEACTIVATE") {
      logger.info("Operation cancelled - confirmation text did not match.");
      return;
    }
    
    logger.info("Deactivating DID...");
    await api.deactivateDid(contract, didId);
    
    logger.info("DID deactivated successfully!");
  } catch (error) {
    logger.error(`Failed to deactivate DID: ${error}`);
  }
};