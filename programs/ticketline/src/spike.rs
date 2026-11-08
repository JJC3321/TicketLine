use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};

// Spike only: PDA-signed vote Withdraw + Authorize CPIs. Replaced by vote.rs later.
pub const VOTE_PROGRAM_ID: Pubkey = Pubkey::from_str_const("Vote111111111111111111111111111111111111111");

#[derive(Accounts)]
pub struct SpikeWithdraw<'info> {
    /// CHECK: vote account owned by the vote program
    #[account(mut, owner = VOTE_PROGRAM_ID)]
    pub vote_account: UncheckedAccount<'info>,
    /// CHECK: lamport recipient
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
    /// CHECK: PDA authorized withdrawer, seeds [b"auth", vote_account]
    #[account(seeds = [b"auth", vote_account.key().as_ref()], bump)]
    pub auth: UncheckedAccount<'info>,
    /// CHECK: vote program
    #[account(address = VOTE_PROGRAM_ID)]
    pub vote_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SpikeAuthorize<'info> {
    /// CHECK: vote account owned by the vote program
    #[account(mut, owner = VOTE_PROGRAM_ID)]
    pub vote_account: UncheckedAccount<'info>,
    /// CHECK: PDA authorized withdrawer, seeds [b"auth", vote_account]
    #[account(seeds = [b"auth", vote_account.key().as_ref()], bump)]
    pub auth: UncheckedAccount<'info>,
    pub clock: Sysvar<'info, Clock>,
    /// CHECK: vote program
    #[account(address = VOTE_PROGRAM_ID)]
    pub vote_program: UncheckedAccount<'info>,
}

pub fn handle_spike_withdraw(ctx: Context<SpikeWithdraw>, lamports: u64) -> Result<()> {
    let mut data = Vec::with_capacity(12);
    data.extend_from_slice(&3u32.to_le_bytes());
    data.extend_from_slice(&lamports.to_le_bytes());
    let ix = Instruction {
        program_id: VOTE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(ctx.accounts.vote_account.key(), false),
            AccountMeta::new(ctx.accounts.recipient.key(), false),
            AccountMeta::new_readonly(ctx.accounts.auth.key(), true),
        ],
        data,
    };
    let vote_key = ctx.accounts.vote_account.key();
    let bump = ctx.bumps.auth;
    invoke_signed(
        &ix,
        &[
            ctx.accounts.vote_account.to_account_info(),
            ctx.accounts.recipient.to_account_info(),
            ctx.accounts.auth.to_account_info(),
        ],
        &[&[b"auth", vote_key.as_ref(), &[bump]]],
    )?;
    Ok(())
}

pub fn handle_spike_authorize(ctx: Context<SpikeAuthorize>, new_authority: Pubkey) -> Result<()> {
    let mut data = Vec::with_capacity(40);
    data.extend_from_slice(&1u32.to_le_bytes());
    data.extend_from_slice(new_authority.as_ref());
    data.extend_from_slice(&1u32.to_le_bytes()); // VoteAuthorize::Withdrawer
    let ix = Instruction {
        program_id: VOTE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(ctx.accounts.vote_account.key(), false),
            AccountMeta::new_readonly(ctx.accounts.clock.key(), false),
            AccountMeta::new_readonly(ctx.accounts.auth.key(), true),
        ],
        data,
    };
    let vote_key = ctx.accounts.vote_account.key();
    let bump = ctx.bumps.auth;
    invoke_signed(
        &ix,
        &[
            ctx.accounts.vote_account.to_account_info(),
            ctx.accounts.clock.to_account_info(),
            ctx.accounts.auth.to_account_info(),
        ],
        &[&[b"auth", vote_key.as_ref(), &[bump]]],
    )?;
    Ok(())
}
