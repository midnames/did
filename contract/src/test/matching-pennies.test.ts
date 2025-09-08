import { MatchingPenniesSimulator } from "./matching-pennies-simulator.js";
import {
  NetworkId,
  setNetworkId
} from "@midnight-ntwrk/midnight-js-network-id";
import { describe, it, expect } from "vitest";
setNetworkId(NetworkId.Undeployed);
describe("MatchingPennies smart contract", () => {
  it("Generates initial ledger state deterministically", () => {
    const simulator0 = new MatchingPenniesSimulator();
    const simulator1 = new MatchingPenniesSimulator();
    expect(simulator0.getLedger()).toEqual(simulator1.getLedger());
  });

  //
  // Commit
  //

  it("Fails to commit twice with same playerId", () => {
    const simulator = new MatchingPenniesSimulator();
    const secretKey = new Uint8Array(32);
    simulator.commitJugada(true, secretKey);
    expect(() => simulator.commitJugada(true, secretKey)).toThrow(
      "Ya jugaste ameo"
    );
  });

  it("Fails to commit when game full", () => {
    const simulator = new MatchingPenniesSimulator();

    const secretKey = new Uint8Array(32);
    secretKey.set([1], 31);
    simulator.commitJugada(true, secretKey);

    const playerId2 = new Uint8Array(32);
    playerId2.set([2], 31);
    simulator.setPlayerId(playerId2);
    simulator.commitJugada(false, secretKey);

    const playerId3 = new Uint8Array(32);
    playerId3.set([3], 31);
    simulator.setPlayerId(playerId3);
    expect(() => simulator.commitJugada(true, secretKey)).toThrow(
      "Ya hay dos jugadas"
    );
  });

  it("Successfully commits", () => {
    const simulator = new MatchingPenniesSimulator();

    const secretKey = new Uint8Array(32);
    secretKey.set([0x00, 0x00, 0x12, 0x34], 28);

    const ledgerBefore = simulator.getLedger();
    simulator.commitJugada(true, secretKey);
    const ledgerAfter = simulator.getLedger();

    expect(ledgerBefore).not.toEqual(ledgerAfter);
    expect(ledgerAfter.jugadaMatcher).toBeDefined();
  });

  //
  // Reveal
  //

  it("Fails to reveal when game not full", () => {
    const simulator = new MatchingPenniesSimulator();

    const secretKey = new Uint8Array(32);
    secretKey.set([0x00, 0x00, 0x12, 0x34], 28);
    simulator.commitJugada(true, secretKey);

    expect(() => simulator.revealJugada(true, secretKey)).toThrow(
      "No hay dos jugadas"
    );
  });

  it("Fails to reveal twice", () => {
    const simulator = new MatchingPenniesSimulator();

    const secretKey = new Uint8Array(32);
    secretKey.set([0x00, 0x00, 0x12, 0x34], 28);
    simulator.commitJugada(true, secretKey);

    const playerId2 = new Uint8Array(32);
    playerId2.set([2], 31);
    simulator.setPlayerId(playerId2);
    simulator.commitJugada(false, secretKey);

    simulator.revealJugada(false, secretKey);

    expect(() => simulator.revealJugada(false, secretKey)).toThrow(
      "Ya revelaste"
    );
  });

  it("Fails to reveal when player not in game", () => {
    const simulator = new MatchingPenniesSimulator();

    const secretKey = new Uint8Array(32);
    secretKey.set([0x00, 0x00, 0x12, 0x34], 28);
    simulator.commitJugada(true, secretKey);

    const playerId2 = new Uint8Array(32);
    playerId2.set([2], 31);
    simulator.setPlayerId(playerId2);
    simulator.commitJugada(false, secretKey);

    const playerId3 = new Uint8Array(32);
    playerId3.set([3], 31);
    simulator.setPlayerId(playerId3);

    expect(() => simulator.revealJugada(true, secretKey)).toThrow(
      "No sos jugador"
    );
  });

  it("Succesfully reveals", () => {
    const simulator = new MatchingPenniesSimulator();

    const secretKey = new Uint8Array(32);
    secretKey.set([0x00, 0x00, 0x12, 0x34], 28);

    simulator.commitJugada(true, secretKey);

    const playerId2 = new Uint8Array(32);
    playerId2.set([2], 31);
    simulator.setPlayerId(playerId2);
    simulator.commitJugada(false, secretKey);

    const ledgerBefore = simulator.getLedger();
    simulator.revealJugada(false, secretKey);

    const ledgerAfter = simulator.getLedger();
    expect(ledgerBefore).not.toEqual(ledgerAfter);
  });

  //
  // Resolve
  //

  it("Fails to resolve when game is empty", () => {
    const simulator = new MatchingPenniesSimulator();
    expect(() => simulator.resolverPartida()).toThrow("No jugó el jugador A");
  });

  it("Fails to resolve when game incomplete", () => {
    const simulator = new MatchingPenniesSimulator();
    const secretKey = new Uint8Array(32);
    secretKey.set([0x00, 0x00, 0x12, 0x34], 28);
    simulator.commitJugada(true, secretKey);
    expect(() => simulator.resolverPartida()).toThrow("No jugó el jugador B");
  });

  it("Fails to resolve when 5 mins not passed", () => {
    const simulator = new MatchingPenniesSimulator();

    const secretKey = new Uint8Array(32);
    secretKey.set([0x00, 0x00, 0x12, 0x34], 28);
    simulator.commitJugada(true, secretKey);

    const playerId2 = new Uint8Array(32);
    playerId2.set([2], 31);
    simulator.setPlayerId(playerId2);
    simulator.commitJugada(false, secretKey);

    expect(() => simulator.resolverPartida()).toThrow(
      "Todavía no pasaron 5 minutos"
    );
  });

  it("Succesfully resolves", () => {
    const simulator = new MatchingPenniesSimulator();

    const secretKey = new Uint8Array(32);
    secretKey.set([0x00, 0x00, 0x12, 0x34], 28);
    simulator.commitJugada(true, secretKey);

    const playerId2 = new Uint8Array(32);
    playerId2.set([2], 31);
    simulator.setPlayerId(playerId2);
    simulator.commitJugada(false, secretKey);

    const playerId1 = new Uint8Array(32);
    playerId1.set([1], 31);
    simulator.setPlayerId(playerId1);
    simulator.revealJugada(true, secretKey);

    simulator.setPlayerId(playerId2);
    simulator.revealJugada(false, secretKey);

    const ledgerBefore = simulator.getLedger();
    simulator.resolverPartida();
    const ledgerAfter = simulator.getLedger();

    expect(ledgerBefore).not.toEqual(ledgerAfter);
    expect(ledgerAfter.lastGameScore.winner).toBe(2);
  });
});
