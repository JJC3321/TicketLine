use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;

use crate::errors::ErrorCode;
use crate::events::SimTicketBurn;
use crate::state::{Pool, Position};
use crate::vote::{parse_v4_header, withdraw_ix, INCINERATOR, VOTE_PROGRAM_ID};

#[derive(Accounts)]
pub struct SimTicketBurnIx<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(
        mut,
        seeds = [b"pos", position.vote_account.as_ref()],
        bump = position.bump,
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
    /// CHECK: the incinerator
    #[account(mut, address = INCINERATOR)]
    pub incinerator: UncheckedAccount<'info>,
    /// CHECK: vote program
    #[account(address = VOTE_PROGRAM_ID)]
    pub vote_program: UncheckedAccount<'info>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle_sim_ticket_burn(ctx: Context<SimTicketBurnIx>) -> Result<()> {
    let pool = &ctx.accounts.pool;
    let data = ctx.accounts.vote_account.try_borrow_data()?;
    let pending = parse_v4_header(&data)?.pending_delegator_rewards;
    let data_len = data.len();
    drop(data);

    let rent = Rent::get()?.minimum_balance(data_len);
    let min_balance = rent.checked_add(pending).ok_or(ErrorCode::MathOverflow)?;
    let remaining = ctx
        .accounts
        .vote_account
        .lamports()
        .checked_sub(pool.ticket_lamports)
        .ok_or(ErrorCode::InsufficientHeadroom)?;
    require!(remaining >= min_balance, ErrorCode::InsufficientHeadroom);

    let vote_key = ctx.accounts.vote_account.key();
    let auth_key = ctx.accounts.auth.key();
    let ix = withdraw_ix(vote_key, INCINERATOR, auth_key, pool.ticket_lamports);
    let bump = ctx.accounts.position.auth_bump;
    invoke_signed(
        &ix,
        &[
            ctx.accounts.vote_account.to_account_info(),
            ctx.accounts.incinerator.to_account_info(),
            ctx.accounts.auth.to_account_info(),
        ],
        &[&[b"auth", vote_key.as_ref(), &[bump]]],
    )?;

    emit!(SimTicketBurn {
        vote_account: vote_key,
        lamports: pool.ticket_lamports,
        epoch: Clock::get()?.epoch,
    });
    Ok(())
}
