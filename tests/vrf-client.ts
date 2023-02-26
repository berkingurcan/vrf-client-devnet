import "mocha";

import * as anchor from "@project-serum/anchor";
import { AnchorProvider } from "@project-serum/anchor";
import * as sbv2 from "@switchboard-xyz/solana.js";
import { VrfClient } from "../target/types/vrf_client";
import { assert } from "chai";
import { BN } from "bn.js";
import { PermissionAccount, QueueAccount, SwitchboardProgram, VrfAccount } from "@switchboard-xyz/solana.js";
import { Connection } from "@solana/web3.js";

const DEFAULT_COMMITMENT = "confirmed";


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
  
    const pseudoPayer = anchor.web3.Keypair.generate()
    

    let switchboard: SwitchboardProgram = await SwitchboardProgram.load(
      "devnet",
      new Connection("https://api.devnet.solana.com"),
      payer /** Optional, READ-ONLY if not provided */
    );

    console.log("BERKİNG")

    const [queueAccount, txnSignature] = await QueueAccount.load(switchboard, "F8ce7MsckeZAbAGmxjJNetxYXQa9mKr9nnrC3qKubyYy")

    console.log(`Transaction signature of queue Account: ${txnSignature}`)
    await queueAccount.isReady();
  
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
  
    // Create VRF Client account
    // INIT CLIENT
    await program.methods
      .initClient({
        maxResult: new anchor.BN(678),
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
    const queue = await queueAccount.loadData();
    const vrf = await vrfAccount.loadData();
    console.log(`WTF is vrf ${vrf}`);
  
    // derive the existing VRF permission account using the seeds
    console.log("permission is coming")
    
    const permissionAccount = await PermissionAccount.create(
      switchboard,
      {
        granter: queueAccount.publicKey,
        grantee: vrfAccount.publicKey,
        authority: queue.authority
      }
    );

    const [cumac ,permissionBump] = PermissionAccount.fromSeed(
      switchboard,
      queue.authority,
      queueAccount.publicKey,
      vrfAccount.publicKey
    )

    console.log(`permisson is done +++ payer token wallet is coming: ${permissionAccount[0].publicKey}`)

    const [payerTokenWallet] =
      await switchboard.mint.getOrCreateWrappedUser(
        switchboard.walletPubkey,
        { fundUpTo: 0.002 }
      );
  
    console.log("Requesssstiiiiiing")

    const vrfAccounts = await vrfAccount.fetchAccounts();
    
    // Request randomness
    await program.methods
      .requestRandomness({
        switchboardStateBump: switchboard.programState.bump,
        permissionBump,
      })
      .accounts({
        state: vrfClientKey,
        vrf: vrfAccount.publicKey,
        oracleQueue: "F8ce7MsckeZAbAGmxjJNetxYXQa9mKr9nnrC3qKubyYy",
        queueAuthority: "2KgowxogBrGqRcgXQEmqFvC3PGtCu66qERNJevYW8Ajh",
        dataBuffer: "7yJ3sSifpmUFB5BcXy6yMDje15xw2CovJjfXfBKsCfT5",
        permission: permissionAccount[0].publicKey,
        escrow: vrf.escrow,
        programState: switchboard.programState.publicKey,
        switchboardProgram: switchboard.programId,
        payerWallet: payerTokenWallet,
        payerAuthority: payer.publicKey,
        recentBlockhashes: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc();
  
    console.log("Requested RANDOMNES!")

    const result = await vrfAccount.nextResult(
      new anchor.BN(vrf.counter.toNumber() + 1),
      45_000
    );

    console.log(result)

    if (!result.success) {
      throw new Error(`Failed to get VRF Result: ${result.status}`);
    }
  
    const vrfClientState = await program.account.vrfClientState.fetch(
      vrfClientKey
    );
    console.log("VRF CLIENT STATE IS COMIIING")
    console.log(vrfClientState)
  
    console.log(`Vrf client state??? ${vrfClientState}`);
    console.log(`Max result: ${vrfClientState.maxResult.toString(10)}`);
    console.log(`Yamanin agzina yüzüne attirdigim random number: ${vrfClientState.result.toString(10)}`);
  
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
