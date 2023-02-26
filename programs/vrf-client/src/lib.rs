use anchor_lang::prelude::*;

pub mod actions;
pub use actions::*;

pub use anchor_lang::solana_program::clock;
pub use anchor_spl::token::{Token, TokenAccount};
pub use switchboard_v2::{
    OracleQueueAccountData, PermissionAccountData, SbState, VrfAccountData, VrfRequestRandomness,
};

declare_id!("7bSz1sxRGdfBNTeRfWpipjYMN11YbZxJFK6jxNBBeZyN");

#[program]
pub mod vrf_client {
    use super::*;

    #[access_control(ctx.accounts.validate(&ctx, &params))]
    pub fn init_client(ctx: Context<InitClient>, params: InitClientParams) -> Result<()> {
        InitClient::actuate(&ctx, &params)
    }

    pub fn add_raffle_list(ctx: Context<AddRaffleList>, raffle_list: String) -> Result<()> {
        let raffle_account_data= &mut ctx.accounts.raffle_list;
        raffle_account_data.bump = *ctx.bumps.get("raffle_list").unwrap();

        raffle_account_data.raffle_list = raffle_list.to_owned();

        msg!("Added Raffle List for {}", raffle_list);
        Ok(())
    }

    #[access_control(ctx.accounts.validate(&ctx, &params))]
    pub fn request_randomness(
        ctx: Context<RequestRandomness>,
        params: RequestRandomnessParams,
    ) -> Result<()> {
        RequestRandomness::actuate(&ctx, &params)
    }

    #[access_control(ctx.accounts.validate(&ctx, &params))]
    pub fn consume_randomness(
        ctx: Context<ConsumeRandomness>,
        params: ConsumeRandomnessParams,
    ) -> Result<()> {
        ConsumeRandomness::actuate(&ctx, &params)
    }
}

const STATE_SEED: &[u8] = b"CLIENTSEED";

#[repr(packed)]
#[account(zero_copy)]
#[derive(Default)]
pub struct VrfClientState {
    pub bump: u8,
    pub max_result: u64,
    pub result_buffer: [u8; 32],
    pub result: u128,
    pub timestamp: i64,
    pub vrf: Pubkey,
}

#[account]
pub struct RaffleList {
    pub raffle_list: String,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct AddRaffleList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 4 + 8 + 32 + 1,
        seeds = ["raffle_list".as_bytes(), vrf_client.key().as_ref()],
        bump,
    )]
    pub raffle_list: Account<'info, RaffleList>,
    #[account(mut)]
    pub vrf_client: AccountLoader<'info, VrfClientState>,
    pub system_program: Program<'info, System>,
}

#[error_code]
#[derive(Eq, PartialEq)]
pub enum VrfClientErrorCode {
    #[msg("Switchboard VRF Account's authority should be set to the client's state pubkey")]
    InvalidVrfAuthorityError,
    #[msg("The max result must not exceed u64")]
    MaxResultExceedsMaximum,
    #[msg("Invalid VRF account provided.")]
    InvalidVrfAccount,
    #[msg("Not a valid Switchboard account")]
    InvalidSwitchboardAccount,
}

#[event]
pub struct VrfClientCreated {
    pub vrf_client: Pubkey,
    pub max_result: u64,
    pub timestamp: i64,
}

#[event]
pub struct RandomnessRequested {
    pub vrf_client: Pubkey,
    pub max_result: u64,
    pub timestamp: i64,
}

#[event]
pub struct VrfClientUpdated {
    pub vrf_client: Pubkey,
    pub max_result: u64,
    pub result_buffer: [u8; 32],
    pub result: u128,
    pub timestamp: i64,
}
