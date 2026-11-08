use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;

use crate::errors::ErrorCode;
use crate::events::SurplusWithdrawn;
use crate::math;
use crate::state::{Pool, Position};
use crate::vote::{parse_v4_header, withdraw_ix, VOTE_PROGRAM_ID};

#[derive(Accounts)]
pub struct WithdrawSurplus<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    #[account(
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
    /// CHECK: must equal position.payout
    #[account(mut, address = position.payout @ ErrorCode::Unauthorized)]
    pub payout: UncheckedAccount<'info>,
    /// CHECK: vote program
    #[account(address = VOTE_PROGRAM_ID)]
    pub vote_program: UncheckedAccount<'info>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handle_withdraw_surplus(ctx: Context<WithdrawSurplus>, lamports: u64) -> Result<()> {
    let pos = &ctx.accounts.position;
    require!(pos.principal == 0 && pos.fees == 0, ErrorCode::DebtOutstanding);

    let data = ctx.accounts.vote_account.try_borrow_data()?;
    let pending = parse_v4_header(&data)?.pending_delegator_rewards;
    let data_len = data.len();
    drop(data);

    let pool = &ctx.accounts.pool;
    let rent = Rent::get()?.minimum_balance(data_len);
    let required = math::required(rent, pending, pool.ticket_lamports, pool.buffer_lamports)?;
    let sweepable = math::sweepable(ctx.accounts.vote_account.lamports(), required);
    require!(lamports <= sweepable, ErrorCode::ExceedsSurplus);

    let vote_key = ctx.accounts.vote_account.key();
    let auth_key = ctx.accounts.auth.key();
    let ix = withdraw_ix(vote_key, ctx.accounts.payout.key(), auth_key, lamports);
    let bump = pos.auth_bump;
    invoke_signed(
        &ix,
        &[
            ctx.accounts.vote_account.to_account_info(),
            ctx.accounts.payout.to_account_info(),
            ctx.accounts.auth.to_account_info(),
        ],
        &[&[b"auth", vote_key.as_ref(), &[bump]]],
    )?;

    emit!(SurplusWithdrawn {
        vote_account: vote_key,
        payout: ctx.accounts.payout.key(),
        lamports,
    });
    Ok(())
}
