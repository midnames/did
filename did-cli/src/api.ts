import {
  Did,
  type DidPrivateState,
  witnesses,
  createDidSecretState,
} from "@midnight-ntwrk/midnight-did-contract";
import {
  type CoinInfo,
  nativeToken,
  Transaction,
  type TransactionId,
} from "@midnight-ntwrk/ledger";
import {
  deployContract,
  findDeployedContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import {
  type BalancedTransaction,
  createBalancedTx,
  type MidnightProvider,
  type UnbalancedTransaction,
  type WalletProvider,
} from "@midnight-ntwrk/midnight-js-types";
import { type Resource, WalletBuilder } from "@midnight-ntwrk/wallet";
import { type Wallet } from "@midnight-ntwrk/wallet-api";
import { Transaction as ZswapTransaction } from "@midnight-ntwrk/zswap";
import { webcrypto } from "crypto";
import { type Logger } from "pino";
import * as Rx from "rxjs";
import { WebSocket } from "ws";
import {
  type DidCircuits,
  type DidContract,
  DidPrivateStateId,
  type DidProviders,
  type DeployedDidContract,
  PublicKey,
  Keys,
  AllowedUsages,
  VerificationMethodType
} from "./common-types";
import { type Config, contractConfig } from "./config";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import {
  getLedgerNetworkId,
  getZswapNetworkId,
} from "@midnight-ntwrk/midnight-js-network-id";
import * as fs from "fs";
import {
  stringToUint8Array,
  toVector5Maybes,
  formatUint8Array,
  uint8ArrayToString,
  formatDidData,
  parsePublicKeyHex,
  parseAdaAddress,
  toControllerVector,
} from "@midnames/utils";
import { toHex } from "@midnight-ntwrk/midnight-js-utils";
import { type DidJsonDocument } from "./types";

let logger: Logger;

// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

export const DidContractInstance: DidContract = new Did.Contract(witnesses);

const SECRET_KEY = new Uint8Array(32);

export const joinContract = async (
  providers: DidProviders,
  contractAddress: string
): Promise<DeployedDidContract> => {
  const localSecretKey = SECRET_KEY;
  const initialPrivateState = createDidSecretState(localSecretKey);

  const DidContract = await findDeployedContract(providers, {
    contractAddress,
    contract: DidContractInstance,
    privateStateId: DidPrivateStateId,
    initialPrivateState,
  });
  logger.info(
    `Joined contract at address: ${DidContract.deployTxData.public.contractAddress}
Witness:
- local_secret_key: ${Buffer.from(localSecretKey).toString("hex")}
    `
  );
  return DidContract;
};

export const deploy = async (
  providers: DidProviders,
  privateState: DidPrivateState
): Promise<DeployedDidContract> => {
  // default context for contract initialization
  const defaultContext = { uri: "https://www.w3.org/ns/did/v1" };

  logger.debug(
    `DEBUG: About to deploy with NetworkId: ${getZswapNetworkId()}, LedgerNetworkId: ${getLedgerNetworkId()}`
  );
  logger.debug(`DEBUG: PrivateStateId: ${DidPrivateStateId}`);
  logger.debug(`DEBUG: DefaultContext: ${JSON.stringify(defaultContext)}`);

  try {
    const DidContract = await deployContract(providers, {
      contract: DidContractInstance,
      privateStateId: DidPrivateStateId,
      initialPrivateState: privateState,
    });
    logger.debug("DEBUG: deployContract succeeded");
    logger.info(
      `Deployed contract at address: ${DidContract.deployTxData.public.contractAddress}`
    );
    return DidContract;
  } catch (error) {
    logger.error(`ERROR: deployContract failed: ${error}`);
    throw error;
  }
};

export const displayContractInfo = async (
  providers: DidProviders,
  DidContract: DeployedDidContract
): Promise<{
  contractAddress: string;
  active: boolean;
  publicKey: Uint8Array<ArrayBufferLike> | null;
} | null> => {
  const contractAddress = DidContract.deployTxData.public.contractAddress;
  const state =
    await providers.publicDataProvider.queryContractState(contractAddress);
  if (state === null) {
    return null;
  }

  const data = state.data;

  logger.info(`data: ${data}`);

  const active = state ? Did.ledger(state.data).active : false;
  const pk = state ? Did.ledger(state.data).controllerPublicKey : null;

  logger.info(`Contract Address: ${contractAddress}`);
  logger.info(`Controller Public Key: ${pk}`);
  return { contractAddress, active, publicKey: pk };
};

export const getDid = async (
  providers: DidProviders,
  contractAddress: string,
  didId: string
): Promise<any | null> => {
  try {
    const state =
      await providers.publicDataProvider.queryContractState(contractAddress);
    if (!state) {
      logger.error("Could not query contract state");
      return null;
    }

    const ledgerState = Did.ledger(state.data);

    logger.info(`ledgerState: ${JSON.stringify(ledgerState, null, 2)}`);

    const didData = {
      active: ledgerState.active,
      controllerPublicKey: ledgerState.controllerPublicKey,
      keyRing: {} as any,
    };

    // // Use the iterator functionality provided by keyRing
    // const keyRingIterator = ledgerState.keyRing[Symbol.iterator]();
    // let iteratorResult = keyRingIterator.next();
    //
    // while (!iteratorResult.done) {
    //   const [keyId, publicKey] = iteratorResult.value;
    //   didData.keyRing[keyId] = publicKey;
    //   iteratorResult = keyRingIterator.next();
    // }

    return didData;
  } catch (error) {
    logger.error(`Failed to retrieve DID: ${error}`);
    return null;
  }
};

export interface DidDocument {
  "@context": string[];
  id: string;
  verificationMethod?: Array<{
    id: string;
    type: string;
    controller: string;
    publicKeyHex?: string;
    publicKeyMultibase?: string;
  }>;
  authentication?: Array<
    | string
    | {
        id: string;
        type: string;
        controller: string;
        publicKeyHex?: string;
        publicKeyMultibase?: string;
      }
  >;
  service?: Array<{
    id: string;
    type: string;
    serviceEndpoint: string;
  }>;
  credentials?: Array<{
    data: string;
    publicKeyMultibase: string;
  }>;
  updated?: string;
  _metadata?: {
    authorizedControllers: string[];
    exists: boolean;
  };
}

export const getDidFormatted = async (
  providers: DidProviders,
  contractAddress: string,
  didId: string
): Promise<DidDocument | null> => {
  const rawData = await getDid(providers, contractAddress, didId);
  if (!rawData) return null;
  return formatDidData(rawData);
};

export const createWalletAndMidnightProvider = async (
  wallet: Wallet
): Promise<WalletProvider & MidnightProvider> => {
  const state = await Rx.firstValueFrom(wallet.state());
  return {
    coinPublicKey: state.coinPublicKey,
    encryptionPublicKey: state.encryptionPublicKey,
    balanceTx(
      tx: UnbalancedTransaction,
      newCoins: CoinInfo[]
    ): Promise<BalancedTransaction> {
      return wallet
        .balanceTransaction(
          ZswapTransaction.deserialize(
            tx.serialize(getLedgerNetworkId()),
            getZswapNetworkId()
          ),
          newCoins
        )
        .then((tx) => wallet.proveTransaction(tx))
        .then((zswapTx) =>
          Transaction.deserialize(
            zswapTx.serialize(getZswapNetworkId()),
            getLedgerNetworkId()
          )
        )
        .then(createBalancedTx);
    },
    submitTx(tx: BalancedTransaction): Promise<TransactionId> {
      return wallet.submitTransaction(tx);
    },
  };
};

export const waitForSync = (wallet: Wallet) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.tap((state) => {
        const applyGap = state.syncProgress?.lag.applyGap ?? 0n;
        const sourceGap = state.syncProgress?.lag.sourceGap ?? 0n;
        logger.info(
          `Waiting for sync. Backend lag: ${sourceGap}, wallet lag: ${applyGap}, transactions=${state.transactionHistory.length}`
        );
      }),
      Rx.filter((state) => {
        return state.syncProgress !== undefined && state.syncProgress.synced;
      })
    )
  );

export const waitForSyncProgress = async (wallet: Wallet) =>
  await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.tap((state) => {
        const applyGap = state.syncProgress?.lag.applyGap ?? 0n;
        const sourceGap = state.syncProgress?.lag.sourceGap ?? 0n;
        logger.info(
          `Waiting for sync progress. Backend lag: ${sourceGap}, wallet lag: ${applyGap}, transactions=${state.transactionHistory.length}`
        );
      }),
      Rx.filter((state) => {
        return state.syncProgress !== undefined;
      })
    )
  );

export const waitForFunds = (wallet: Wallet) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.tap((state) => {
        const applyGap = state.syncProgress?.lag.applyGap ?? 0n;
        const sourceGap = state.syncProgress?.lag.sourceGap ?? 0n;
        logger.info(
          `Waiting for funds. Backend lag: ${sourceGap}, wallet lag: ${applyGap}, transactions=${state.transactionHistory.length}`
        );
      }),
      Rx.filter((state) => {
        return state.syncProgress?.synced === true;
      }),
      Rx.map((s) => s.balances[nativeToken()] ?? 0n),
      Rx.filter((balance) => balance > 0n)
    )
  );

export const buildWalletAndWaitForFunds = async (
  { indexer, indexerWS, node, proofServer }: Config,
  seed: string,
  filename: string
): Promise<Wallet & Resource> => {
  const directoryPath = process.env.SYNC_CACHE;
  let wallet: Wallet & Resource;
  if (directoryPath !== undefined) {
    if (fs.existsSync(`${directoryPath}/${filename}`)) {
      logger.info(
        `Attempting to restore state from ${directoryPath}/${filename}`
      );
      try {
        const serialized = fs.readFileSync(
          `${directoryPath}/${filename}`,
          "utf-8"
        );
        wallet = await WalletBuilder.restore(
          indexer,
          indexerWS,
          proofServer,
          node,
          seed,
          serialized,
          "info"
        );
        wallet.start();

        const newState = await waitForSync(wallet);
        if (!newState.syncProgress?.synced) {
          logger.warn(
            "Wallet was not able to sync from restored state, building wallet from scratch"
          );
          wallet = await WalletBuilder.buildFromSeed(
            indexer,
            indexerWS,
            proofServer,
            node,
            seed,
            getZswapNetworkId(),
            "info"
          );
          wallet.start();
        }
      } catch (error: unknown) {
        if (typeof error === "string") {
          logger.error(error);
        } else if (error instanceof Error) {
          logger.error(error.message);
        } else {
          logger.error(error);
        }
        logger.warn(
          "Wallet was not able to restore using the stored state, building wallet from scratch"
        );
        wallet = await WalletBuilder.buildFromSeed(
          indexer,
          indexerWS,
          proofServer,
          node,
          seed,
          getZswapNetworkId(),
          "info"
        );
        wallet.start();
      }
    } else {
      logger.info("Wallet save file not found, building wallet from scratch");
      wallet = await WalletBuilder.buildFromSeed(
        indexer,
        indexerWS,
        proofServer,
        node,
        seed,
        getZswapNetworkId(),
        "info"
      );
      wallet.start();
    }
  } else {
    logger.info(
      "File path for save file not found, building wallet from scratch"
    );
    wallet = await WalletBuilder.buildFromSeed(
      indexer,
      indexerWS,
      proofServer,
      node,
      seed,
      getZswapNetworkId(),
      "info"
    );
    wallet.start();
  }

  const state = await Rx.firstValueFrom(wallet.state());
  logger.info(`Your wallet seed is: ${seed}`);
  logger.info(`Your wallet address is: ${state.address}`);
  let balance = state.balances[nativeToken()];
  if (balance === undefined || balance === 0n) {
    logger.info(`Your wallet balance is: 0`);
    logger.info(`Waiting to receive tokens...`);
    balance = await waitForFunds(wallet);
  }
  logger.info(`Your wallet balance is: ${balance}`);
  return wallet;
};

export const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  webcrypto.getRandomValues(bytes);
  return bytes;
};

export const configureProviders = async (
  wallet: Wallet & Resource,
  config: Config
) => {
  const walletAndMidnightProvider =
    await createWalletAndMidnightProvider(wallet);
  return {
    privateStateProvider: levelPrivateStateProvider<typeof DidPrivateStateId>({
      privateStateStoreName: contractConfig.privateStateStoreName,
    }),
    publicDataProvider: indexerPublicDataProvider(
      config.indexer,
      config.indexerWS
    ),
    zkConfigProvider: new NodeZkConfigProvider<DidCircuits>(
      contractConfig.zkConfigPath
    ),
    proofProvider: httpClientProofProvider(config.proofServer),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
};

export function setLogger(_logger: Logger) {
  logger = _logger;
}

export const buildFreshWallet = async (
  config: Config
): Promise<Wallet & Resource> => {
  const seed = toHex(randomBytes(32));
  logger.info(`Building fresh wallet with generated seed...`);
  const filename = `midnames-wallet-fresh.json`;
  return await buildWalletAndWaitForFunds(config, seed, filename);
};

const createDefaultContext = () => ({
  uri: "",
});

const createDefaultVerificationMethod = (): any => ({
  id: "",
  type: "",
  key: {
    is_left: true,
    left: { hex: new Uint8Array(130) },
    right: { address: new Uint8Array(104) },
  },
  controller: [
    new Uint8Array(64),
    new Uint8Array(64),
    new Uint8Array(64),
    new Uint8Array(64),
    new Uint8Array(64),
  ],
  OtherKeys: { is_some: false, value: [["", ""]] },
});

const createDefaultAuthenticationMethod = (): any => ({
  is_left: true,
  left: "",
  right: createDefaultVerificationMethod(),
});

const createDefaultService = (): any => ({
  id: "",
  type: "",
  serviceEndpoint: "",
  OtherKeys: { is_some: false, value: [["", ""]] },
});

const createDefaultCredential = (): any => ({
  data: "",
  publicKeyMultibase: "",
});

export const createDidFromDocument = async (
  DidContract: DeployedDidContract,
  didDocument: DidJsonDocument,
  providers?: DidProviders,
  customPrivateKey?: Uint8Array,
  multipleLocalSecretKeys?: Uint8Array[]
): Promise<{ txId: string; didId: string }> => {
  logger.info(`Creating DID from document: ${didDocument.id}`);

  try {
    const didIdBytes = stringToUint8Array(didDocument.id, 64);

    const contextArray = didDocument.context ||
      didDocument["@context"] || ["https://www.w3.org/ns/did/v1"];
    const context = contextArray.map((ctx) => ({
      uri: ctx,
    }));

    const verificationMethods = didDocument.verificationMethod?.map(
      (vm, index) => {
        let key: {
          is_left: boolean;
          left: { hex: Uint8Array };
          right: { address: Uint8Array };
        };
        if (vm.publicKeyHex) {
          key = {
            is_left: true,
            left: { hex: parsePublicKeyHex(vm.publicKeyHex) },
            right: { address: new Uint8Array(104) },
          };
        } else {
          key = {
            is_left: true,
            left: { hex: new Uint8Array(130) },
            right: { address: new Uint8Array(104) },
          };
        }

        return {
          id: vm.id.split("#")[1] || `keys-${index + 1}`,
          type: vm.type || "BIP32-Ed25519",
          key,
          controller: toControllerVector(vm.controller || didDocument.id),
          OtherKeys: { is_some: false, value: [["key1", "key2"]] },
        };
      }
    ) || [createDefaultVerificationMethod()];

    const authenticationMethods = didDocument.authentication?.map((auth) => {
      if (typeof auth === "string") {
        return {
          is_left: true,
          left: auth.split("#")[1] || "keys-1",
          right: createDefaultVerificationMethod(),
        };
      } else {
        return {
          is_left: false,
          left: "",
          right: {
            id: auth.id.split("#")[1] || "auth-1",
            type: auth.type || "BIP32-Ed25519",
            key: auth.publicKeyHex
              ? {
                  is_left: true,
                  left: { hex: parsePublicKeyHex(auth.publicKeyHex) },
                  right: { address: new Uint8Array(104) },
                }
              : auth.publicKeyMultibase
                ? {
                    is_left: true,
                    left: { hex: parsePublicKeyHex(auth.publicKeyMultibase) },
                    right: { address: new Uint8Array(104) },
                  }
                  : {
                      is_left: true,
                      left: { hex: new Uint8Array(130) },
                      right: { address: new Uint8Array(104) },
                    },
            controller: toControllerVector(auth.controller || didDocument.id),
            OtherKeys: { is_some: false, value: [["key1", "key2"]] },
          },
        };
      }
    }) || [createDefaultAuthenticationMethod()];

    const services = didDocument.service?.map((svc) => ({
      id: svc.id?.split("#")[1] || "default-service",
      type: svc.type || "DefaultService",
      serviceEndpoint: svc.serviceEndpoint || "https://example.com",
      OtherKeys: { is_some: false, value: [["key1", "key2"]] },
    })) || [createDefaultService()];

    const credentials = didDocument.credentials?.map((cred) => ({
      data: cred.data || "default-credential-data",
      publicKeyMultibase: cred.publicKeyMultibase || "default-key",
    })) || [createDefaultCredential()];

    const authorizedPublicAddresses: Uint8Array[] = [];

    logger.info("Generating proof and creating DID transaction...");

    if (providers && customPrivateKey && multipleLocalSecretKeys) {
      // Use custom private key provided by user
      if (multipleLocalSecretKeys.length > 0) {
        logger.info(
          `Using ${multipleLocalSecretKeys.length} additional secret keys`
        );
      }

      const customPrivateState = createDidSecretState(customPrivateKey);
      await providers.privateStateProvider.set(
        DidPrivateStateId,
        customPrivateState
      );
      logger.info("Using custom private key for witness");
    } else if (providers) {
      const currentPrivateState =
        await providers.privateStateProvider.get(DidPrivateStateId);
      if (currentPrivateState) {
        logger.info("Using existing private state with deployment keys");
      } else {
        logger.error(
          "No private state found - this should not happen after deployment"
        );
      }
    }

    const finalAuthMethods =
      authenticationMethods.length > 0 ? authenticationMethods : [];
    const finalVerificationMethods =
      verificationMethods.length > 0 ? verificationMethods : [];
    const finalServices = services.length > 0 ? services : [];
    const finalCredentials = credentials.length > 0 ? credentials : [];
    const finalContext = context.length > 0 ? context : [];
    const finalAuthorizedAddresses = authorizedPublicAddresses;

    // const authVector = toVector5Maybes(
    //   finalAuthMethods,
    //   createDefaultAuthenticationMethod()
    // );
    // const verificationVector = toVector5Maybes(
    //   finalVerificationMethods,
    //   createDefaultVerificationMethod()
    // );
    // const serviceVector = toVector5Maybes(
    //   finalServices,
    //   createDefaultService()
    // );
    // const credentialVector = toVector5Maybes(
    //   finalCredentials,
    //   createDefaultCredential()
    // );
    // const contextVector = toVector5Maybes(finalContext, createDefaultContext());
    // const addressVector = toVector5Maybes(
    //   finalAuthorizedAddresses,
    //   new Uint8Array(32)
    // );

    // const finalizedTxData = await DidContract.callTx.create_did(
    //   didIdBytes,
    //   authVector,
    //   verificationVector,
    //   serviceVector,
    //   credentialVector,
    //   contextVector,
    //   addressVector
    // );

    return {
      txId: "foo",
      didId: didDocument.id,
    };
  } catch (error) {
    logger.error(`Failed to create DID from document: ${error}`);
    throw new Error(`DID creation failed: ${error}`);
  }
};

export const addVerificationKey = async (
  DidContract: DeployedDidContract,
  keyId: string,
  publicKeyData: string,
  keyType: "jwk" | "multibase" = "multibase",
  allowedUsages: AllowedUsages
): Promise<void> => {
  const jwk_key: Keys = {
    is_left: true,
    left: {
      kty: Did.KeyType.EC,
      crv: Did.CurveType.Ed25519,
      x: 0n,
    },
    right: { key: "" },
  };
  const multibase_key: Keys = {
    is_left: false,
    left: {
      crv: Did.CurveType.Ed25519,
      kty: Did.KeyType.EC,
      x: 0n,
    },
    right: {
      key: publicKeyData,
    },
  };

  try {
    const keyData: PublicKey = {
      id: keyId,
      type: Did.VerificationMethodType.Ed25519VerificationKey2020,
      publicKey: keyType === "jwk" ? jwk_key : multibase_key,
      allowedUsages: allowedUsages,
    };

    const finalizedTxData = await DidContract.callTx.addKey(keyData);

    logger.info(
      `Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`
    );
  } catch (error) {
    logger.error(`Failed to add verification key: ${error}`);
    throw new Error(`Adding verification key failed: ${error}`);
  }
};

export const removeVerificationKey = async (
  DidContract: DeployedDidContract,
  keyId: string
): Promise<{ txId: string }> => {
  try {
    const finalizedTxData = await DidContract.callTx.removeKey(keyId);

    logger.info(
      `Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`
    );

    return {
      txId: finalizedTxData.public.txId,
    };
  } catch (error) {
    logger.error(`Failed to remove verification key: ${error}`);
    throw new Error(`Removing verification key failed: ${error}`);
  }
};

export async function addKeyAllowedUsage(
  contract: DeployedDidContract,
  keyId: string,
  actionType: Did.ActionType
): Promise<{ txId: string }> {
  try {
    logger.info(
      `Adding allowed usage ${Did.ActionType[actionType]} to key ${keyId} for DID: did:midnames:${contract.deployTxData.public.contractAddress}`
    );

    const finalizedTxData = await contract.callTx.addAllowedUsage(keyId, actionType);

    logger.info(
      `Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`
    );

    return {
      txId: finalizedTxData.public.txId,
    };
  } catch (error) {
    logger.error(`Failed to add key allowed usage: ${error}`);
    throw new Error(`Adding key allowed usage failed: ${error}`);
  }
};

export async function removeKeyAllowedUsage(
  contract: DeployedDidContract,
  keyId: string,
  actionType: Did.ActionType
): Promise<{ txId: string }> {
  try {
    logger.info(
      `Removing allowed usage ${Did.ActionType[actionType]} to key ${keyId} for DID: did:midnames:${contract.deployTxData.public.contractAddress}`
    );

    const finalizedTxData = await contract.callTx.removeAllowedUsage(keyId, actionType);

    logger.info(
      `Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`
    );

    return {
      txId: finalizedTxData.public.txId,
    };
  } catch (error) {
    logger.error(`Failed to add key allowed usage: ${error}`);
    throw new Error(`Adding key allowed usage failed: ${error}`);
  }
};

// export const removeKeyAllowedUsage = async (
//   midnamesContract: DeployedDidContract,
//   didId: string,
//   keyId: string,
//   actionType: string
// ): Promise<{ txId: string }> => {
//   try {
//     logger.info(
//       `Removing allowed usage ${actionType} from key ${keyId} for DID: ${didId}`

//     const keyIdBytes = stringToUint8Array(keyId, 64);

//     let actionTypeEnum: number;
//     switch (actionType) {
//       case "Authentication":
//         actionTypeEnum = 0;
//         break;
//       case "AssertionMethod":
//         actionTypeEnum = 1;
//         break;
//       case "KeyAgreement":
//         actionTypeEnum = 2;
//         break;
//       case "CapabilityInvocation":
//         actionTypeEnum = 3;
//         break;
//       case "CapabilityDelegation":
//         actionTypeEnum = 4;
//         break;
//       default:
//         throw new Error(`Invalid action type: ${actionType}`);
//     }

//     const finalizedTxData = await midnamesContract.callTx.removeAllowedUsage(
//       keyIdBytes,
//       actionTypeEnum
//     );

//     logger.info(
//       `Transaction ${finalizedTxData.public.txId} added in block ${finalizedTxData.public.blockHeight}`
//     );

//     return {
//       txId: finalizedTxData.public.txId,
//     };
//   } catch (error) {
//     logger.error(`Failed to remove key allowed usage: ${error}`);
//     throw new Error(`Removing key allowed usage failed: ${error}`);
//   }
// };

function parseDid(contractAddress: string, v: PublicKey) {
  const DID = {
    id: v.id,
    type: `${Did.VerificationMethodType[v.type]}`,
    controller: `did:midnight:${contractAddress}`,
    ...(v.publicKey.is_left
      ? {
          publicKeyJwk: {
            crv: v.publicKey.left.crv,
            kty: v.publicKey.left.kty,
            x: v.publicKey.left.x.toString(),
          },
        }
      : {
          publicKeyMultibase: v.publicKey.right.key,
        }),
  };

  return DID;
}

export async function viewDidDetails(
  contractAddress: string,
  providers: DidProviders
) {
  try {
    const contractState =
      await providers.publicDataProvider.queryContractState(contractAddress);
    if (contractState === null) {
      return;
    }

    const ledgerState = Did.ledger(contractState.data);
    const verificationMethod = [];
    const authenticationMethod = [];
    const capabilityDelegation = [];
    const capabilityInvocation = [];

    for (const [k, v] of ledgerState.keyRing) {
      const keyUsage = v.allowedUsages;
      // Verification key
      if (!keyUsage.authentication) {
        verificationMethod.push(parseDid(contractAddress, v));
      }
      // Authentication key
      if (keyUsage.authentication) {
        authenticationMethod.push(parseDid(contractAddress, v));
      }
      // Capability Delegation key
      if (keyUsage.capabilityDelegation) {
        capabilityDelegation.push(parseDid(contractAddress, v));
      }
      // Capability Invocation key
      if (keyUsage.capabilityInvocation) {
        capabilityInvocation.push(parseDid(contractAddress, v));
      }
    }

    const didDocument = {
      "@context": "https://www.w3.org/ns/did/v1.1",
      id: `did:midnames:${contractAddress}`,
      authentication: authenticationMethod,
      verificationMethod: verificationMethod,
      capabilityInvocation: capabilityInvocation,
      capabilityDelegation: capabilityDelegation,
      service: [],
    };
    logger.info(JSON.stringify(didDocument, null, 2));
  } catch (error) {
    logger.error(`Failed to view DID details: ${error}`);
  }
}

export const deactivateDid = async (
  didContract: DeployedDidContract,
  didId: string
): Promise<{ txId: string }> => {
  try {
    logger.info(`Deactivating DID: ${didId}`);

    const finalizedTxData = await didContract.callTx.deactivate();

    return {
      txId: finalizedTxData.public.txId,
    };
  } catch (error) {
    logger.error(`Failed to deactivate DID: ${error}`);
    throw new Error(`DID deactivation failed: ${error}`);
  }
};
