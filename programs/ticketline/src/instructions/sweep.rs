use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;

use crate::errors::ErrorCode;
use crate::events::Sweep;
use crate::math;
use crate::state::{Pool, Position};
use crate::vote::{parse_v4_header, withdraw_ix, VOTE_PROGRAM_ID};

#[derive(Accounts)]
pub struct SweepIx<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    /// CHECK: system vault PDA
    #[account(mut, seeds = [b"vault", pool.key().as_ref()], bump = pool.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"pos", position.vote_account.as_ref()],
        bump = position.bump,
    )]
    pub position: Account<'info, Position>,
    /// CHECK: position's vote account, owned by the vote program
    #[account(
        mut,
        owner = VOTE_PROGRAM_ID @ ErrorCode::InvalidVoteAccount,
        constraint = vote_account.key() == position.vote_account @ ErrorCode::InvalidVoteAccount,
    )]
    pub vote_account: UncheckedAccount<'info>,
    /// CHECK: auth PDA = vote account authorized_withdrawer
    #[account(seeds = [b"auth", vote_account.key().as_ref()], bump = position.auth_bump)]
    pub auth: UncheckedAccount<'info>,
    /// CHECK: vote program
    #[account(address = VOTE_PROGRAM_ID)]
    pub vote_program: UncheckedAccount<'info>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle_sweep(ctx: Context<SweepIx>) -> Result<()> {
    let epoch = Clock::get()?.epoch;
    let data = ctx.accounts.vote_account.try_borrow_data()?;
    let pending = parse_v4_header(&data)?.pending_delegator_rewards;
    let data_len = data.len();
    drop(data);

    let pool = &ctx.accounts.pool;
    let rent = Rent::get()?.minimum_balance(data_len);
    let required = math::required(rent, pending, pool.ticket_lamports, pool.buffer_lamports)?;
    let sweepable = math::sweepable(ctx.accounts.vote_account.lamports(), required);

    let pos = &mut ctx.accounts.position;
    let debt = pos.principal.checked_add(pos.fees).ok_or(ErrorCode::MathOverflow)?;
    let repay = sweepable.min(debt);
    require!(repay > 0, ErrorCode::NothingToSweep);

    // PDA-signed vote Withdraw -> vault
    let vote_key = ctx.accounts.vote_account.key();
    let auth_key = ctx.accounts.auth.key();
    let ix = withdraw_ix(vote_key, ctx.accounts.vault.key(), auth_key, repay);
    let bump = pos.auth_bump;
    invoke_signed(
        &ix,
        &[
            ctx.accounts.vote_account.to_account_info(),
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.auth.to_account_info(),
        ],
        &[&[b"auth", vote_key.as_ref(), &[bump]]],
    )?;

    // fees first, then principal
    let fee_part = repay.min(pos.fees);
    let principal_part = repay - fee_part;
    pos.fees -= fee_part;
    pos.principal -= principal_part;
    pos.total_repaid = pos.total_repaid.checked_add(repay).ok_or(ErrorCode::MathOverflow)?;

    let pool = &mut ctx.accounts.pool;
    pool.total_principal =
        pool.total_principal.checked_sub(principal_part).ok_or(ErrorCode::MathOverflow)?;
    pool.total_fees_outstanding =
        pool.total_fees_outstanding.checked_sub(fee_part).ok_or(ErrorCode::MathOverflow)?;
    pool.total_fees_earned =
        pool.total_fees_earned.checked_add(fee_part).ok_or(ErrorCode::MathOverflow)?;

    emit!(Sweep {
        vote_account: pos.vote_account,
        repaid: repay,
        fee_part,
        principal_part,
        epoch,
        principal: pos.principal,
        fees: pos.fees,
    });
    Ok(())
}
