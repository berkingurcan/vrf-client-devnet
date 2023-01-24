import "mocha";

import * as anchor from "@project-serum/anchor";
import { AnchorProvider } from "@project-serum/anchor";
import * as sbv2 from "@switchboard-xyz/solana.js";
import { VrfClient } from "../target/types/vrf_client";
import { assert } from "chai";
import { BN } from "bn.js";

describe("vrf-client", () => {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program: anchor.Program<VrfClient> = anchor.workspace.VrfClient;
  const payer = (provider.wallet as sbv2.AnchorWallet).payer;

  const vrfSecret = anchor.web3.Keypair.generate();
  console.log(`VRF Account: ${vrfSecret.publicKey}`);

  const [vrfClientKey] = anchor.utils.publicKey.findProgramAddressSync(
    [Buffer.from("CLIENTSEED"), vrfSecret.publicKey.toBytes()],
    program.programId
  );
  console.log(`VRF Client: ${vrfClientKey}`);

  const vrfIxCoder = new anchor.BorshInstructionCoder(program.idl);
  const vrfClientCallback: sbv2.Callback = {
    programId: program.programId,
    accounts: [
      // ensure all accounts in consumeRandomness are populated
      { pubkey: vrfClientKey, isSigner: false, isWritable: true },
      { pubkey: vrfSecret.publicKey, isSigner: false, isWritable: false },
    ],
    ixData: vrfIxCoder.encode("consumeRandomness", ""), // pass any params for instruction here
  };

  let switchboard: sbv2.SwitchboardTestContextV2;
  let vrfAccount: sbv2.VrfAccount;

  before(async () => {
    switchboard = await sbv2.SwitchboardTestContextV2.loadFromProvider(
      provider,
      {
        // You can provide a keypair to so the PDA schemes dont change between test runs
        name: "Test Queue",
        keypair: sbv2.SwitchboardTestContextV2.loadKeypair(
          "~/.keypairs/queue.json"
        ),
        queueSize: 10,
        reward: 0,
        minStake: 0,
        oracleTimeout: 900,
        unpermissionedFeeds: true,
        unpermissionedVrf: true,
        enableBufferRelayers: true,
        oracle: {
          name: "Test Oracle",
          enable: true,
          stakingWalletKeypair: sbv2.SwitchboardTestContextV2.loadKeypair(
            "~/.keypairs/oracleWallet.json"
          ),
        },
      }
    );
    await switchboard.start(
      "dev-v2-RC_01_24_23_20_38",
      {
        envVariables: {
          DISABLE_NONCE_QUEUE: "true",
        },
      },
      60
    );
  });

  after(async () => {
    if (switchboard) {
      switchboard.stop();
    }
  });

  it("init_client", async () => {
    const queue = await switchboard.queue.loadData();

    // Create Switchboard VRF and Permission account
    [vrfAccount] = await switchboard.queue.createVrf({
      callback: vrfClientCallback,
      authority: vrfClientKey, // vrf authority
      vrfKeypair: vrfSecret,
      enable: !queue.unpermissionedVrfEnabled, // only set permissions if required
    });

    console.log(`Created VRF Account: ${vrfAccount.publicKey}`);

    // Create VRF Client account
    await program.methods
      .initClient({
        maxResult: new anchor.BN(1337),
      })
      .accounts({
        state: vrfClientKey,
        vrf: vrfAccount.publicKey,
        payer: payer.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log(`Created VrfClient Account: ${vrfClientKey}`);
  });

  it("request_randomness", async () => {
    const queue = await switchboard.queue.loadData();
    const vrf = await vrfAccount.loadData();

    // derive the existing VRF permission account using the seeds
    const [permissionAccount, permissionBump] = sbv2.PermissionAccount.fromSeed(
      switchboard.program,
      queue.authority,
      switchboard.queue.publicKey,
      vrfAccount.publicKey
    );

    const [payerTokenWallet] =
      await switchboard.program.mint.getOrCreateWrappedUser(
        switchboard.program.walletPubkey,
        { fundUpTo: 0.002 }
      );

    // Request randomness
    await program.methods
      .requestRandomness({
        switchboardStateBump: switchboard.program.programState.bump,
        permissionBump,
      })
      .accounts({
        state: vrfClientKey,
        vrf: vrfAccount.publicKey,
        oracleQueue: switchboard.queue.publicKey,
        queueAuthority: queue.authority,
        dataBuffer: queue.dataBuffer,
        permission: permissionAccount.publicKey,
        escrow: vrf.escrow,
        programState: switchboard.program.programState.publicKey,
        switchboardProgram: switchboard.program.programId,
        payerWallet: payerTokenWallet,
        payerAuthority: payer.publicKey,
        recentBlockhashes: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc();

    const result = await vrfAccount.nextResult(
      new anchor.BN(vrf.counter.toNumber() + 1),
      45_000
    );
    if (!result.success) {
      throw new Error(`Failed to get VRF Result: ${result.status}`);
    }

    const vrfClientState = await program.account.vrfClientState.fetch(
      vrfClientKey
    );
    console.log(`VrfClient Result: ${vrfClientState.result.toString(10)}`);

    const callbackTxnMeta = await vrfAccount.getCallbackTransactions();
    console.log(
      JSON.stringify(
        callbackTxnMeta.map((tx) => tx.meta.logMessages),
        undefined,
        2
      )
    );

    assert(!vrfClientState.result.eq(new BN(0)), "Vrf Client holds no result");
  });
});
