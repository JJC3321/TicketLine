use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;

use crate::errors::ErrorCode;
use crate::events::Exited;
use crate::state::Position;
use crate::vote::{authorize_withdrawer_ix, VOTE_PROGRAM_ID};

#[derive(Accounts)]
pub struct Exit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        close = owner,
        seeds = [b"pos", position.vote_account.as_ref()],
        bump = position.bump,
        constraint = position.owner == owner.key() @ ErrorCode::Unauthorized,
    )]
    pub position: Account<'info, Position>,
    /// CHECK: position's vote account
    #[account(
        mut,
        owner = VOTE_PROGRAM_ID @ ErrorCode::InvalidVoteAccount,
        constraint = vote_account.key() == position.vote_account @ ErrorCode::InvalidVoteAccount,
    )]
    pub vote_account: UncheckedAccount<'info>,
    /// CHECK: auth PDA
    #[account(seeds = [b"auth", vote_account.key().as_ref()], bump = position.auth_bump)]
    pub auth: UncheckedAccount<'info>,
    pub clock: Sysvar<'info, Clock>,
    /// CHECK: vote program
    #[account(address = VOTE_PROGRAM_ID)]
    pub vote_program: UncheckedAccount<'info>,
}

pub fn handle_exit(ctx: Context<Exit>, new_withdrawer: Pubkey) -> Result<()> {
    let pos = &ctx.accounts.position;
    require!(pos.principal == 0 && pos.fees == 0, ErrorCode::DebtOutstanding);

    let vote_key = ctx.accounts.vote_account.key();
    let auth_key = ctx.accounts.auth.key();
    let ix = authorize_withdrawer_ix(vote_key, auth_key, new_withdrawer);
    let bump = pos.auth_bump;
    invoke_signed(
        &ix,
        &[
            ctx.accounts.vote_account.to_account_info(),
            ctx.accounts.clock.to_account_info(),
            ctx.accounts.auth.to_account_info(),
        ],
        &[&[b"auth", vote_key.as_ref(), &[bump]]],
    )?;

    emit!(Exited { vote_account: vote_key, new_withdrawer });
    Ok(())
}
