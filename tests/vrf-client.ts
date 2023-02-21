import "mocha";

import * as anchor from "@project-serum/anchor";
import { AnchorProvider } from "@project-serum/anchor";
import * as sbv2 from "@switchboard-xyz/solana.js";
import { VrfClient } from "../target/types/vrf_client";
import { assert } from "chai";
import { BN } from "bn.js";
import { QueueAccount, SwitchboardProgram, VrfAccount } from "@switchboard-xyz/solana.js";
import { Connection } from "@solana/web3.js";


describe("vrf-client", async () => {
  try {
    const idl = JSON.parse(
      require("fs").readFileSync("./target/idl/vrf_client.json", "utf8")
    );
  
    const programId = new anchor.web3.PublicKey("EmEvpcSsVwZ3VVuQEKiqiGNBYEDy52TBVz1WULdccjzA")
  
    const provider = AnchorProvider.env();
    anchor.setProvider(provider);
  
    const program = new anchor.Program(idl, programId);
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
  
    let switchboard: SwitchboardProgram = await SwitchboardProgram.load(
      "devnet",
      new Connection("https://api.devnet.solana.com"),
      payer /** Optional, READ-ONLY if not provided */
    );
  
    console.log("BERKİNG")
    const [queueAccount, txnSignature] = await QueueAccount.create(switchboard, {
      name: 'My Queue',
      metadata: 'Top secret',
      queueSize: 100,
      reward: 0.00001337,
      minStake: 10,
      oracleTimeout: 60,
      slashingEnabled: false,
      unpermissionedFeeds: true,
      unpermissionedVrf: true,
      enableBufferRelayers: false,
    });

    await queueAccount.isReady();
  
    console.log(`Transaction signature of queue Account: ${txnSignature}`)
  
    const queue = await queueAccount.loadData();
    console.log(`queue: ${queue}`)
  
    const [vrfAccount] = await VrfAccount.create(switchboard, {
      vrfKeypair: vrfSecret,
      authority: vrfClientKey,
      queueAccount: queueAccount,
      callback: {
      programId: program.programId,
      accounts: [
          { pubkey: vrfClientKey, isSigner: false, isWritable: true },
          { pubkey: vrfSecret.publicKey, isSigner: false, isWritable: false },
      ],
      ixData: new anchor.BorshInstructionCoder(program.idl).encode(
          "consumeRandomness",
          ""
      ),
      },
  });
    // Create Switchboard VRF and Permission account
    
    console.log(`Created VRF Account: ${vrfAccount.publicKey}`);
    console.log(vrfAccount)
  
    // Create VRF Client account
    // INIT CLIENT
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
  
    console.log("Now requestin randomness sectionnnnnn hadi!!!");
    // REQUEST RANDOMNESSSSSSSSSSSSSSSSSSSSSSSSSSSS
  
    const vrf = await vrfAccount.loadData();
    console.log(`WTF is vrf ${vrf}`);
  
    // derive the existing VRF permission account using the seeds
    const [permissionAccount, permissionBump] = sbv2.PermissionAccount.fromSeed(
      switchboard,
      queue.authority,
      switchboard.programState.publicKey,
      vrfAccount.publicKey
    );
  
    const [payerTokenWallet] =
      await switchboard.mint.getOrCreateWrappedUser(
        switchboard.walletPubkey,
        { fundUpTo: 0.002 }
      );
  
    // Request randomness
    await program.methods
      .requestRandomness({
        switchboardStateBump: switchboard.programState.bump,
        permissionBump,
      })
      .accounts({
        state: vrfClientKey,
        vrf: vrfAccount.publicKey,
        oracleQueue: switchboard.programState.publicKey,
        queueAuthority: queue.authority,
        dataBuffer: queue.dataBuffer,
        permission: permissionAccount.publicKey,
        escrow: vrf.escrow,
        programState: switchboard.programState.publicKey,
        switchboardProgram: switchboard.programId,
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
  
    const vrfClientState = await program.account.VrfClientState.fetch(
      vrfClientKey
    );
  
    console.log(`Vrf client state??? ${vrfClientState}`);
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
  
  } catch (error) {
    console.error(error)
  }
  });
